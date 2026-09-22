import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

// Microphone access requires a secure context. `localhost` is exempt, but testing on a
// phone over the LAN is not — so `HTTPS=1 npm run dev:lan` adds a self-signed cert.
const useHttps = process.env.HTTPS === '1';

// GitHub Pages serves from a subpath. Deploy with BASE_PATH=/UkeFriend/ npm run build
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    ...(useHttps ? [basicSsl()] : []),
    VitePWA({
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
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
