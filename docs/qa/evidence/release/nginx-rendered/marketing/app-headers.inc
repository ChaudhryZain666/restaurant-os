# Phase 88 — security headers for the marketing site (included by every content location of
# frontend.conf.template). Nothing frames the marketing site; it frames the storefront demo itself,
# which the storefront's own frame-ancestors allows.
add_header Content-Security-Policy "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
