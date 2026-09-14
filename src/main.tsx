import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import App from './App';

let applyUpdate: (reloadPage?: boolean) => Promise<void> = async () => {};

applyUpdate = registerSW({
  immediate: true,
  onNeedRefresh() {
    void applyUpdate(true);
  },
  onRegisteredSW(_swUrl, registration) {
    const checkForUpdate = () => {
      if (navigator.onLine) void registration?.update().catch(() => undefined);
    };
    window.setInterval(checkForUpdate, 60_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
    window.addEventListener('online', checkForUpdate);
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
  if (document.visibilityState === 'visible') scheduleViewportRefresh();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

scheduleViewportRefresh();
