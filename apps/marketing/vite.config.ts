import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { checkLegalConfig, LEGAL_NOT_CONFIGURED_WARNING, sitemapWithoutLegalPages } from "./legalConfig.mjs";

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
function siteOrigin(siteUrl: string | undefined, legalConfigured: boolean): Plugin {
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
      // Phase 89 (legal option C) — while the legal pages only say "being finalized", they are not
      // listed for search engines (the pages and nginx also send noindex). Done here, in the one hook
      // that rewrites sitemap.xml, so two hooks never race over the same file.
      if (!legalConfigured) {
        const sitemapPath = resolve(dist, "sitemap.xml");
        writeFileSync(sitemapPath, sitemapWithoutLegalPages(readFileSync(sitemapPath, "utf8")));
      }
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

/**
 * Phase 88 — the legal pages state facts only the founder can supply (src/lib/legal.ts).
 * Phase 89 (option C) — with NONE provided the build continues with a loud warning and the pages
 * show "being finalized"; a partial set, a placeholder or a malformed email still fails the build.
 * The rules live in legalConfig.mjs (tested with `node --test`).
 */
function assertLegalConfig(env: Record<string, string>): boolean {
  const { configured, problems } = checkLegalConfig(env);
  if (problems.length) {
    throw new Error(
      `Refusing a production build of the marketing site: the legal values are incomplete or invalid (${problems.join("; ")}). See apps/marketing/src/lib/legal.ts.`
    );
  }
  if (!configured) console.warn(LEGAL_NOT_CONFIGURED_WARNING);
  return configured;
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "VITE_");
  // Only a production build is judged; dev and other modes keep the full draft pages (and sitemap).
  const legalConfigured = command === "build" && mode === "production" ? assertLegalConfig(env) : true;
  return {
    plugins: [react(), siteOrigin(env.VITE_SITE_URL, legalConfigured)],
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
