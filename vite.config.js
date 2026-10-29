import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  worker: { format: 'es' },
  resolve: { alias: { elkjs: 'elkjs/lib/elk.bundled.js' } },
  build: { chunkSizeWarningLimit: 1200 },
})
