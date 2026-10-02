import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Phase 85A — robots.txt must name its sitemap with an absolute URL. public/robots.txt keeps the
 * relative `Sitemap: /sitemap.xml` (correct for local dev, where the proxy below serves it); a
 * production build rewrites it from VITE_SITE_URL — the storefront's own origin, e.g.
 * https://order.garnishtable.com, the same variable apps/marketing's build uses. The API's sitemap
 * already lists custom-domain URLs for restaurants that have one, and a sitemap referenced from
 * robots.txt may live on another host, so custom-domain storefronts serving this same build point at
 * the same platform sitemap. Unset, the relative line is kept and the build warns.
 */
function absoluteSitemap(siteUrl: string | undefined): Plugin {
  const origin = siteUrl?.replace(/\/+$/, '')
  return {
    name: 'garnishtable-storefront-sitemap',
    apply: 'build',
    closeBundle() {
      if (!origin) {
        this.warn('VITE_SITE_URL is not set — dist/robots.txt keeps a relative Sitemap line. Set it to the storefront origin before deploying.')
        return
      }
      const robots = resolve(import.meta.dirname, 'dist', 'robots.txt')
      writeFileSync(robots, readFileSync(robots, 'utf8').replace(/^Sitemap:.*$/m, `Sitemap: ${origin}/sitemap.xml`))
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_')
  return {
    plugins: [react(), absoluteSitemap(env.VITE_SITE_URL)],
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
  }
})
