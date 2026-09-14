import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import App from './App';

declare const __MYCOMAP_BUILD_ID__: string;

declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

let applyUpdate: (reloadPage?: boolean) => Promise<void> = async () => {};
let activeRegistration: ServiceWorkerRegistration | undefined;
let updateInProgress = false;
let reloadScheduled = false;

const UPDATE_CHECK_MS = 45_000;
const UPDATE_GRACE_MS = 3_500;
const TILE_CACHE_NAME = 'mycomap-ign-tiles-v1';
const FORCED_BUILD_KEY = 'mycomap:last-forced-build';
const MANUAL_MAP_KEY = 'mycomap:manual-map-navigation';
const IS_STANDALONE = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const BOOT_STARTED_AT = Date.now();

// iOS peut rendre la position GPS plusieurs secondes après le lancement. Si l'utilisateur
// a déjà commencé à explorer la carte, cette réponse tardive ne doit jamais le ramener
// brutalement à sa position. Le bouton "Me localiser" reste toujours prioritaire.
let manualMapNavigation = sessionStorage.getItem(MANUAL_MAP_KEY) === '1';
let explicitLocateUntil = 0;

window.addEventListener('pointerdown', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  if (target.closest('[aria-label="Me localiser"]')) {
    explicitLocateUntil = Date.now() + 6_000;
    manualMapNavigation = false;
    sessionStorage.removeItem(MANUAL_MAP_KEY);
    return;
  }

  if (target.closest('.maplibregl-canvas, .map')) {
    manualMapNavigation = true;
    sessionStorage.setItem(MANUAL_MAP_KEY, '1');
  }
}, { capture: true, passive: true });

const geolocation = navigator.geolocation;
if (geolocation) {
  const nativeGetCurrentPosition = geolocation.getCurrentPosition.bind(geolocation);
  const guardedGetCurrentPosition: Geolocation['getCurrentPosition'] = (success, error, options) => {
    const explicitLocate = Date.now() <= explicitLocateUntil;
    const startupRequest = !explicitLocate && Date.now() - BOOT_STARTED_AT <= 15_000;

    nativeGetCurrentPosition(
      (position) => {
        if (startupRequest && manualMapNavigation) return;
        success(position);
      },
      (reason) => {
        if (startupRequest && manualMapNavigation) return;
        error?.(reason);
      },
      options
    );
  };

  try {
    geolocation.getCurrentPosition = guardedGetCurrentPosition;
  } catch {
    // Certains moteurs rendent cette méthode non réassignable. Dans ce cas l'app
    // conserve le comportement natif plutôt que de casser la géolocalisation.
  }
}

function compactBuildId(buildId: string) {
  return buildId.replace(/[^0-9A-Za-z]/g, '').slice(0, 18);
}

function buildReloadUrl(remoteBuildId: string) {
  const url = new URL(import.meta.env.BASE_URL, window.location.origin);
  url.searchParams.set('__mycomap_build', compactBuildId(remoteBuildId));
  url.searchParams.set('__network', String(Date.now()));
  return url.toString();
}

function alreadyForcedFor(remoteBuildId: string) {
  const compact = compactBuildId(remoteBuildId);
  const urlBuild = new URL(window.location.href).searchParams.get('__mycomap_build');
  return urlBuild === compact || localStorage.getItem(FORCED_BUILD_KEY) === remoteBuildId;
}

function markForcedBuild(remoteBuildId: string) {
  localStorage.setItem(FORCED_BUILD_KEY, remoteBuildId);
}

function waitForControllerChange(timeoutMs = UPDATE_GRACE_MS) {
  return new Promise<boolean>((resolve) => {
    if (!('serviceWorker' in navigator)) {
      resolve(false);
      return;
    }

    let finished = false;
    const finish = (changed: boolean) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
      resolve(changed);
    };
    const onChange = () => finish(true);
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
  });
}

async function waitForWaitingWorker(registration?: ServiceWorkerRegistration) {
  if (!registration) return undefined;
  if (registration.waiting) return registration.waiting;
  const worker = registration.installing;
  if (!worker) return undefined;

  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, 2_500);
    const onState = () => {
      if (worker.state === 'installed' || worker.state === 'activated' || worker.state === 'redundant') {
        window.clearTimeout(timer);
        worker.removeEventListener('statechange', onState);
        resolve();
      }
    };
    worker.addEventListener('statechange', onState);
    onState();
  });

  return registration.waiting;
}

async function removeOnlyAppShellCaches() {
  if (!('caches' in window)) return;
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name !== TILE_CACHE_NAME && (name.includes('workbox-precache') || name.includes('precache')))
      .map((name) => caches.delete(name))
  );
}

async function unregisterMycoMapWorkers() {
  if (!('serviceWorker' in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin).href;
  await Promise.all(
    registrations
      .filter((registration) => registration.scope.startsWith(baseUrl))
      .map((registration) => registration.unregister())
  );
}

async function emergencyNetworkReload(remoteBuildId: string) {
  if (!IS_STANDALONE || reloadScheduled || alreadyForcedFor(remoteBuildId)) return;
  reloadScheduled = true;
  markForcedBuild(remoteBuildId);

  // On ne touche jamais à IndexedDB ni à localStorage utilisateur.
  // Les sorties, photos, coins et caches métier restent intacts.
  await Promise.allSettled([
    unregisterMycoMapWorkers(),
    removeOnlyAppShellCaches()
  ]);

  window.location.replace(buildReloadUrl(remoteBuildId));
}

async function activatePublishedBuild(remoteBuildId: string, registration = activeRegistration) {
  if (updateInProgress || reloadScheduled) return;
  updateInProgress = true;

  try {
    // Dans Safari normal, on laisse uniquement le cycle standard du service worker
    // se faire. Aucun rechargement automatique agressif : cela évite toute boucle.
    if (!IS_STANDALONE) {
      await registration?.update().catch(() => undefined);
      await applyUpdate(false).catch(() => undefined);
      return;
    }

    // Une même version distante ne peut provoquer qu'un seul rechargement forcé.
    if (alreadyForcedFor(remoteBuildId)) {
      await registration?.update().catch(() => undefined);
      return;
    }

    const controllerChange = waitForControllerChange();

    await registration?.update().catch(() => undefined);
    const waitingWorker = await waitForWaitingWorker(registration);
    waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
    await applyUpdate(false).catch(() => undefined);

    const changed = await controllerChange;
    if (changed) {
      markForcedBuild(remoteBuildId);
      reloadScheduled = true;
      window.location.replace(buildReloadUrl(remoteBuildId));
      return;
    }

    await emergencyNetworkReload(remoteBuildId);
  } finally {
    if (!reloadScheduled) updateInProgress = false;
  }
}

async function checkPublishedVersion(registration = activeRegistration) {
  if (!navigator.onLine || updateInProgress || reloadScheduled) return;
  try {
    const url = `${import.meta.env.BASE_URL}version.json?t=${Date.now()}`;
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
    });
    if (!response.ok) return;
    const published = await response.json() as { buildId?: string };
    if (!published.buildId) return;

    if (published.buildId === __MYCOMAP_BUILD_ID__) {
      // La bonne version est enfin active : on réarme le mécanisme pour la prochaine release.
      localStorage.removeItem(FORCED_BUILD_KEY);
      return;
    }

    await activatePublishedBuild(published.buildId, registration);
  } catch {
    // Réseau instable : on conserve la version courante et on réessaiera plus tard.
  }
}

applyUpdate = registerSW({
  immediate: true,
  onNeedRefresh() {
    // Activation silencieuse. Le rechargement éventuel est piloté par le contrôle
    // versionné ci-dessus et seulement en mode PWA standalone.
    void applyUpdate(false);
  },
  onRegisteredSW(_swUrl, registration) {
    activeRegistration = registration;
    const checkForUpdate = () => {
      if (!navigator.onLine) return;
      void checkPublishedVersion(registration);
    };
    checkForUpdate();
    window.setInterval(checkForUpdate, UPDATE_CHECK_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
    window.addEventListener('online', checkForUpdate);
    window.addEventListener('pageshow', checkForUpdate);
  }
});

const nudgeMapResize = () => {
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
};

window.addEventListener('orientationchange', nudgeMapResize);
window.addEventListener('pageshow', nudgeMapResize);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    nudgeMapResize();
    void checkPublishedVersion();
  }
});
window.addEventListener('online', () => void checkPublishedVersion());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

nudgeMapResize();
void checkPublishedVersion();
