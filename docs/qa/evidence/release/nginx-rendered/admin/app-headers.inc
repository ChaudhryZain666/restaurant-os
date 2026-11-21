# Phase 88 — security headers for Owner/Agency/Platform Admin/POS (included by every content
# location of frontend.conf.template). An authenticated application that nothing else may frame:
# frame-ancestors 'self' plus X-Frame-Options for older browsers (clickjacking protection). It may
# itself frame the storefront (live menu preview) — that is governed by the storefront's policy.
# Deliberately no script-src/connect-src: the portals talk to the API host, Socket.IO and Paddle.
add_header Content-Security-Policy "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
