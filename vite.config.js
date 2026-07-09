import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // In dev, proxy websocket traffic to the game server, which `npm run
      // dev` starts on 5174 (unprivileged, so it works on Windows where :80
      // is usually taken by IIS/HTTP.sys, and on Linux/macOS without root).
      '/ws': {
        target: 'ws://localhost:5174',
        ws: true,
      },
    },
  },
});
