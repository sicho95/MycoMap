import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const base = '/MycoMap/';
const buildId = new Date().toISOString();

const versionFilePlugin: Plugin = {
  name: 'mycomap-version-file',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'version.json',
      source: JSON.stringify({ buildId })
    });
  }
};

export default defineConfig({
  base,
  define: {
    __MYCOMAP_BUILD_ID__: JSON.stringify(buildId)
  },
  plugins: [
    react(),
    versionFilePlugin,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: `${base}index.html`,
        globIgnores: ['**/version.json'],
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
        lang: 'fr',
        icons: [
          { src: `${base}apple-touch-icon.png?v=20260914-2`, sizes: '180x180', type: 'image/png', purpose: 'any' },
          { src: `${base}icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      }
    })
  ]
});
