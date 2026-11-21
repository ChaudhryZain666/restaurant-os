// Renders the PRODUCTION nginx templates (infrastructure/docker/nginx) for a local nginx 1.27.4 run,
// changing only what the Docker image would provide differently: envsubst values (API_UPSTREAM,
// FRAME_ANCESTORS), Linux paths (/usr/share/nginx/html, /etc/nginx/conf.d) and the listen port
// (one nginx serves all three apps on 8081/8082/8083 instead of three containers on :80).
const fs = require("fs");
const path = require("path");
const REPO = "D:/restaurant-os-white-label";
const OUT = path.join(__dirname, "nginx-run").replace(/\\/g, "/");
const TPL = `${REPO}/infrastructure/docker/nginx`;
const APPS = { marketing: 8081, web: 8082, admin: 8083 };

fs.mkdirSync(`${OUT}/logs`, { recursive: true });
fs.mkdirSync(`${OUT}/temp`, { recursive: true });
const subst = (s) => s.replace(/\$\{API_UPSTREAM\}/g, "http://127.0.0.1:4000").replace(/\$\{FRAME_ANCESTORS\}/g, "'self'");
const includes = [];
for (const [app, port] of Object.entries(APPS)) {
  const dir = `${OUT}/${app}`;
  fs.mkdirSync(dir, { recursive: true });
  const fixIncludes = (s) => s.replace(/\/etc\/nginx\/conf\.d\//g, `${dir}/`);
  let conf = subst(fs.readFileSync(`${TPL}/frontend.conf.template`, "utf8"));
  if (!conf.includes("listen 80 default_server;")) throw new Error("listen line changed");
  conf = conf.replace("listen 80 default_server;", `listen ${port};`);
  conf = conf.replace("root /usr/share/nginx/html;", `root ${REPO}/apps/${app}/dist;`);
  conf = fixIncludes(conf);
  fs.writeFileSync(`${dir}/default.conf`, conf);
  fs.writeFileSync(`${dir}/app-locations.inc`, fixIncludes(subst(fs.readFileSync(`${TPL}/${app}.locations.template`, "utf8"))));
  fs.writeFileSync(`${dir}/app-headers.inc`, fixIncludes(subst(fs.readFileSync(`${TPL}/${app}.headers.template`, "utf8"))));
  // frontend.prod.Dockerfile writes this for every app; marketing legal values are unconfigured here.
  fs.writeFileSync(`${dir}/legal-robots.inc`, app === "marketing" ? 'add_header X-Robots-Tag "noindex, nofollow" always;\n' : "# not the marketing app\n");
  includes.push(`    include ${dir}/default.conf;`);
}
// Main config equivalent to the nginx:1.27-alpine image's own nginx.conf (mime types, sendfile).
const NGINX = path.join(__dirname, "..", "..", "..", "02cc75adc39c9ac9");
fs.writeFileSync(`${OUT}/nginx.conf`, `worker_processes 1;
error_log ${OUT}/logs/error.log warn;
pid ${OUT}/logs/nginx.pid;
events { worker_connections 256; }
http {
    include mime.types;
    default_type application/octet-stream;
    sendfile on;
    keepalive_timeout 65;
    access_log ${OUT}/logs/access.log;
${includes.join("\n")}
}
`);
console.log("rendered into", OUT);
