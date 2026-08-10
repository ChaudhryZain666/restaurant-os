# Development image — runs the customer storefront with Vite's dev server + HMR.
FROM node:22-slim

WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/utils/package.json packages/utils/package.json
RUN npm install

COPY packages ./packages
COPY apps/web ./apps/web

RUN npm run build:packages

EXPOSE 5173
CMD ["npm", "run", "dev", "-w", "apps/web", "--", "--host"]
