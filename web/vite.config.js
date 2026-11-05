import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// In development, Vite serves the interface on :5173 and forwards API calls to the Kapyiŋi server on :3000.
export default defineConfig({
  // fileURLToPath gives a correct path on Windows too ("C:\\..."), unlike URL.pathname ("/C:/...").
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000', '/paypal': 'http://localhost:3000' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
