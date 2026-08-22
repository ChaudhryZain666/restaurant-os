import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      // The API generates this dynamically from real restaurant data (see
      // apps/api/src/routes/sitemap.routes.ts) — proxied so it's same-origin with robots.txt's
      // `Sitemap:` line in dev. A production deployment needs an equivalent reverse-proxy rule.
      '/sitemap.xml': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
