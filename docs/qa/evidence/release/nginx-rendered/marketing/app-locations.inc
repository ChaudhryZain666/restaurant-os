# Marketing — robots.txt and sitemap.xml are static files from the build (rewritten to the real
# origin by apps/marketing/vite.config.ts when VITE_SITE_URL is set; the legal pages are left out of
# the sitemap while unconfigured).

# Phase 89 (legal option C) — the three legal pages, served exactly like the SPA fallback (index.html,
# never cached) with the usual security headers, plus legal-robots.inc: written at image build
# (frontend.prod.Dockerfile), it sends "X-Robots-Tag: noindex, nofollow" while the legal values are
# not configured and nothing once they are. Server-side, so crawlers that don't run JavaScript see it
# too. try_files with a file (not a URI) serves it here, keeping this location's headers.
location ~* ^/(terms|privacy|refund-policy)/?$ {
    try_files /index.html =404;
    add_header Cache-Control "no-cache";
    include C:/Users/chaud/AppData/Local/Temp/claude/d--Restaurant-online-ordering/d81e7596-acda-4a4d-939a-55f36f94a7c6/scratchpad/qa/nginx-run/marketing/app-headers.inc;
    include C:/Users/chaud/AppData/Local/Temp/claude/d--Restaurant-online-ordering/d81e7596-acda-4a4d-939a-55f36f94a7c6/scratchpad/qa/nginx-run/marketing/legal-robots.inc;
}

# Case-insensitive (~*) like the app's router: /Pricing renders the pricing page, so it must not
# answer 404 (Windows nginx test run, 15 Nov). QA-011 — the site's pages (apps/marketing/src/App.tsx's routes; marketing/routes.test.mjs keeps
# the two lists in step). Served as the SPA shell with 200.
location = / {
    try_files /index.html =404;
    add_header Cache-Control "no-cache";
    include C:/Users/chaud/AppData/Local/Temp/claude/d--Restaurant-online-ordering/d81e7596-acda-4a4d-939a-55f36f94a7c6/scratchpad/qa/nginx-run/marketing/app-headers.inc;
}
location ~* ^/(product|solutions|how-it-works|pricing|faq|demo|about|contact|start-trial|v3)/?$ {
    try_files /index.html =404;
    add_header Cache-Control "no-cache";
    include C:/Users/chaud/AppData/Local/Temp/claude/d--Restaurant-online-ordering/d81e7596-acda-4a4d-939a-55f36f94a7c6/scratchpad/qa/nginx-run/marketing/app-headers.inc;
}

# QA-011 — anything else that isn't a real file (a typo, a dead link, the dev-only /v2 draft) used
# to get the SPA shell with 200, a "soft 404" search engines index. It still gets the shell — the
# app renders its own "page not found" — but with a real 404 status. /assets/ keeps its own
# long-cache location and /api/ its proxy.
location ~ ^/(?!assets/|api/) {
    try_files $uri =404;
    error_page 404 /index.html;
    include C:/Users/chaud/AppData/Local/Temp/claude/d--Restaurant-online-ordering/d81e7596-acda-4a4d-939a-55f36f94a7c6/scratchpad/qa/nginx-run/marketing/app-headers.inc;
}
