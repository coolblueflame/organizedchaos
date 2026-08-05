/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

/*
  A service worker is only reinstalled when sw.js itself changes, and workbox
  writes a BARE `importScripts('sw-push.js')` — so editing the push handler
  alone changed nothing the browser could see. Devices kept running the old
  copy forever, silently. (Caught 2026-08-05: a push-handler change deployed
  green, was live on the server, and could never have reached a phone.)

  Stamping the content hash into the import URL ties the two together: any
  edit to the handler changes sw.js, which is what triggers an update, and the
  new URL sidesteps the HTTP cache on the way in.
*/
const pushHandlerHash = createHash('sha256')
  .update(readFileSync('public/sw-push.js'))
  .digest('hex')
  .slice(0, 8);

export default defineConfig({
  // Served from a GitHub Pages project site, so all asset URLs live under this base.
  base: '/organizedchaos/',
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/icon.svg'],
      manifest: {
        name: 'Organized Chaos',
        short_name: 'Chaos',
        description: 'A todo list that brings order through chance',
        start_url: '/organizedchaos/',
        scope: '/organizedchaos/',
        display: 'standalone',
        background_color: '#0b0e14',
        theme_color: '#0b0e14',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,woff2}'],
        // Push + notification-click handlers ride along with the generated SW.
        importScripts: [`sw-push.js?v=${pushHandlerHash}`],
        // sql.js wasm (~1.6MB) must precache so import works offline too
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['src/tests/setup.ts'],
  },
});
