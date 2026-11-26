import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        // The notification card is its own window, so it needs its own entry.
        toast: resolve(__dirname, 'toast.html')
      }
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  }
})
