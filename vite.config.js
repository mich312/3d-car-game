import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // In dev, proxy websocket traffic to the game server
      '/ws': {
        target: `ws://localhost:${process.env.PORT || 80}`,
        ws: true,
      },
    },
  },
});
