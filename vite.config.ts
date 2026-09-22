import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

// Microphone access requires a secure context. `localhost` is exempt, but testing on a
// phone over the LAN is not — so `HTTPS=1 npm run dev:lan` adds a self-signed cert.
const useHttps = process.env.HTTPS === '1';

// Serve from a subpath by setting this, e.g. BASE_PATH=/lele/ npm run build.
// Every asset, the manifest and the service-worker scope follow it.
const base = process.env.BASE_PATH ?? '/';

// The offline service worker is on by default, but a password-protected deployment
// wants the opposite: nothing cached on the device, so every load goes through the
// password. DISABLE_PWA=1 drops the plugin, which also drops sw.js, workbox,
// registerSW.js and the manifest — no app code references any of them, the plugin
// injects them all.
const enablePwa = process.env.DISABLE_PWA !== '1';

const pwa = VitePWA({
  registerType: 'autoUpdate',
  includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
  manifest: {
    name: 'UkeFriend — Ukulele Chord Trainer',
    short_name: 'UkeFriend',
    description:
      'Learn ukulele chords with diagrams, tab, progression suggestions and live microphone feedback.',
    theme_color: '#1b1725',
    background_color: '#1b1725',
    display: 'standalone',
    orientation: 'any',
    start_url: base,
    scope: base,
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
  },
});

export default defineConfig({
  base,
  plugins: [react(), ...(useHttps ? [basicSsl()] : []), ...(enablePwa ? [pwa] : [])],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
