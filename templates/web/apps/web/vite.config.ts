import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // strictPort, so a port already taken is an error rather than a silent
  // move to another one that every other tool is still looking for.
  server: { port: Number(process.env.WEB_PORT ?? 5273), strictPort: true },
});
