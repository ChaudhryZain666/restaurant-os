# Owner Portal / Agency Portal / Platform Admin / POS — an authenticated application that is never
# indexed (public/robots.txt disallows everything); it has no sitemap.
location = /sitemap.xml {
    return 404;
}
