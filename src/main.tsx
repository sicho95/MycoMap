import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import App from './App';

declare const __MYCOMAP_BUILD_ID__: string;

let applyUpdate: (reloadPage?: boolean) => Promise<void> = async () => {};
let activeRegistration: ServiceWorkerRegistration | undefined;
let updateInProgress = false;
let reloadScheduled = false;

function scheduleHardReload(remoteBuildId: string) {
  if (reloadScheduled) return;
  reloadScheduled = true;
  window.setTimeout(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('__mycomap_build', remoteBuildId.replace(/[^0-9A-Za-z]/g, '').slice(0, 18));
    window.location.replace(url.toString());
  }, 1400);
}

async function checkPublishedVersion(registration = activeRegistration) {
  if (!navigator.onLine || updateInProgress) return;
  try {
    const url = `${import.meta.env.BASE_URL}version.json?t=${Date.now()}`;
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
    });
    if (!response.ok) return;
    const published = await response.json() as { buildId?: string };
    if (!published.buildId || published.buildId === __MYCOMAP_BUILD_ID__) return;

    updateInProgress = true;
    await registration?.update().catch(() => undefined);
    await applyUpdate(true).catch(() => undefined);
    scheduleHardReload(published.buildId);
  } catch {
    // En cas de réseau instable on conserve simplement la version courante.
  } finally {
    window.setTimeout(() => { updateInProgress = false; }, 2500);
  }
}

navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (reloadScheduled) return;
  reloadScheduled = true;
  window.location.reload();
});

applyUpdate = registerSW({
  immediate: true,
  onNeedRefresh() {
    void applyUpdate(true);
  },
  onRegisteredSW(_swUrl, registration) {
    activeRegistration = registration;
    const checkForUpdate = () => {
      if (!navigator.onLine) return;
      void registration?.update().catch(() => undefined);
      void checkPublishedVersion(registration);
    };
    checkForUpdate();
    window.setInterval(checkForUpdate, 45_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
    window.addEventListener('online', checkForUpdate);
    window.addEventListener('pageshow', checkForUpdate);
  }
});

// iOS standalone peut figer le conteneur MapLibre sur la hauteur disponible
// au tout début du lancement. On donne donc une taille en pixels issue du vrai
// viewport, puis on déclenche le recalcul interne de MapLibre.
const refreshMapViewport = () => {
  const viewportHeight = Math.max(
    window.innerHeight || 0,
    document.documentElement.clientHeight || 0,
    window.visualViewport?.height || 0
  );
  const viewportWidth = Math.max(
    window.innerWidth || 0,
    document.documentElement.clientWidth || 0,
    window.visualViewport?.width || 0
  );

  document.documentElement.style.setProperty('--mycomap-vh', `${viewportHeight}px`);

  const shell = document.querySelector<HTMLElement>('.app-shell');
  if (shell) {
    shell.style.height = `${viewportHeight}px`;
    shell.style.width = `${viewportWidth}px`;
  }

  const map = document.querySelector<HTMLElement>('.map');
  if (map) {
    map.style.setProperty('position', 'fixed', 'important');
    map.style.setProperty('inset', '0', 'important');
    map.style.setProperty('width', `${viewportWidth}px`, 'important');
    map.style.setProperty('height', `${viewportHeight}px`, 'important');
    map.style.setProperty('min-height', `${viewportHeight}px`, 'important');
  }

  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
};

const scheduleViewportRefresh = () => {
  refreshMapViewport();
  window.setTimeout(refreshMapViewport, 80);
  window.setTimeout(refreshMapViewport, 250);
  window.setTimeout(refreshMapViewport, 700);
  window.setTimeout(refreshMapViewport, 1500);
};

window.visualViewport?.addEventListener('resize', scheduleViewportRefresh);
window.visualViewport?.addEventListener('scroll', scheduleViewportRefresh);
window.addEventListener('resize', refreshMapViewport);
window.addEventListener('orientationchange', scheduleViewportRefresh);
window.addEventListener('pageshow', scheduleViewportRefresh);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    scheduleViewportRefresh();
    void checkPublishedVersion();
  }
});
window.addEventListener('online', () => void checkPublishedVersion());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

scheduleViewportRefresh();
void checkPublishedVersion();
