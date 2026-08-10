# Development image — runs the restaurant/platform admin dashboard with Vite's dev server + HMR.
FROM node:22-slim

WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/utils/package.json packages/utils/package.json
RUN npm install

COPY packages ./packages
COPY apps/admin ./apps/admin

RUN npm run build:packages

EXPOSE 5174
CMD ["npm", "run", "dev", "-w", "apps/admin", "--", "--host"]
