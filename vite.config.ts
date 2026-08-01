/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

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
        description: 'A todo list that tempts fate',
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
        importScripts: ['sw-push.js'],
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
