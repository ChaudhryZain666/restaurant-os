import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** The placeholder origin public/sitemap.xml is authored with (no production domain yet). */
const SITEMAP_PLACEHOLDER = "https://www.garnishtable.app";

/**
 * Production-origin wiring, driven by VITE_SITE_URL (the same variable usePageMeta and Layout
 * already read at runtime):
 *
 * - index.html gets static Open Graph / Twitter defaults (the homepage's), because Facebook,
 *   LinkedIn, Slack and most link unfurlers never run JavaScript — without these a shared link
 *   previews with no image or description at all. usePageMeta updates the same tags in place once
 *   the app runs (applySeoMeta never duplicates a tag the shell already has).
 * - dist/robots.txt's Sitemap line and dist/sitemap.xml's <loc>s are rewritten to the real origin
 *   (robots.txt requires an absolute sitemap URL).
 *
 * Unset (local dev, or a build before the domain exists), the image URL stays root-relative and the
 * sitemap keeps its placeholder — and the production build says so loudly.
 */
function siteOrigin(siteUrl: string | undefined): Plugin {
  const origin = siteUrl?.replace(/\/+$/, "");
  return {
    name: "garnishtable-site-origin",
    transformIndexHtml(html) {
      const title = /<title>(.*?)<\/title>/s.exec(html)?.[1]?.trim() ?? "GarnishTable";
      const description = /<meta\s+name="description"\s+content="([^"]*)"/s.exec(html)?.[1] ?? "";
      const image = `${origin ?? ""}/og-image.png`;
      const tags: [string, string, string][] = [
        ["property", "og:type", "website"],
        ["property", "og:site_name", "GarnishTable"],
        ["property", "og:title", title],
        ["property", "og:description", description],
        ["property", "og:image", image],
        ["property", "og:image:width", "1200"],
        ["property", "og:image:height", "630"],
        ["property", "og:image:alt", "GarnishTable — Your restaurant. Running on your terms."],
        ["name", "twitter:card", "summary_large_image"],
        ["name", "twitter:title", title],
        ["name", "twitter:description", description],
        ["name", "twitter:image", image],
      ];
      return tags.map(([attr, key, content]) => ({
        tag: "meta",
        attrs: { [attr]: key, content },
        injectTo: "head" as const,
      }));
    },
    closeBundle() {
      const dist = resolve(import.meta.dirname, "dist");
      if (!origin) {
        this.warn(
          "VITE_SITE_URL is not set — og:image is root-relative and dist/sitemap.xml still uses the " +
            `${SITEMAP_PLACEHOLDER} placeholder. Set VITE_SITE_URL to the production origin before deploying.`
        );
        return;
      }
      const sitemap = resolve(dist, "sitemap.xml");
      writeFileSync(sitemap, readFileSync(sitemap, "utf8").split(SITEMAP_PLACEHOLDER).join(origin));
      const robots = resolve(dist, "robots.txt");
      writeFileSync(
        robots,
        readFileSync(robots, "utf8").replace(/^Sitemap:.*$/m, `Sitemap: ${origin}/sitemap.xml`)
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "VITE_");
  return {
    plugins: [react(), siteOrigin(env.VITE_SITE_URL)],
    server: {
      port: 5175,
      // Phase 28 — mirrors apps/web/vite.config.ts's exact proxy: makes the new public/* API calls
      // same-origin in dev, same as apps/web and apps/admin already are.
      proxy: {
        "/api": {
          target: "http://localhost:4000",
          changeOrigin: true,
        },
      },
    },
  };
});
