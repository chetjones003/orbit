import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Builds the renderer for the Tauri shell. Electron keeps using electron.vite.config.ts until the port finishes.
export default defineConfig({
  root: resolve('src/renderer'),
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: {
    outDir: resolve('dist'),
    emptyOutDir: true,
    rollupOptions: { input: resolve('src/renderer/index.html') }
  }
});
