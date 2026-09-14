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

// iOS peut modifier la hauteur du viewport juste après le lancement d'une PWA
// sans émettre le resize attendu par MapLibre. Un resize synthétique force le
// canvas à reprendre exactement la taille réellement disponible.
const refreshMapViewport = () => {
  window.dispatchEvent(new Event('resize'));
};

const scheduleViewportRefresh = () => {
  requestAnimationFrame(refreshMapViewport);
  window.setTimeout(refreshMapViewport, 120);
  window.setTimeout(refreshMapViewport, 450);
};

window.visualViewport?.addEventListener('resize', scheduleViewportRefresh);
window.visualViewport?.addEventListener('scroll', scheduleViewportRefresh);
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
