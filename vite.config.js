import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // In dev, the game server runs on 3001; proxy websocket traffic to it
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
