import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const base = '/MycoMap/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/data\.geopf\.fr\/wmts/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'mycomap-ign-tiles-v1',
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 900,
                maxAgeSeconds: 30 * 24 * 60 * 60,
                purgeOnQuotaError: true
              }
            }
          }
        ]
      },
      manifest: {
        name: 'MycoMap',
        short_name: 'MycoMap',
        description: 'Carte privée de potentiel mycologique et mémoire de terrain.',
        theme_color: '#101512',
        background_color: '#101512',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: base,
        scope: base,
        icons: [
          { src: `${base}icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      }
    })
  ]
});
