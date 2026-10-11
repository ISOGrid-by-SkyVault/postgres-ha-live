import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const target = process.env.API_TARGET ?? 'http://localhost:8095'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': { target, ws: true, changeOrigin: true } },
    watch: { usePolling: true },
  },
})
