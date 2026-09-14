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

// Important sur iOS/PWA : on ne modifie plus manuellement la hauteur ou la
// largeur de la carte après le rendu. Le conteneur CSS reste fixé à l'écran et
// MapLibre recalcule simplement son canvas à partir de sa taille réelle.
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
