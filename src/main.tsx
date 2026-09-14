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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
