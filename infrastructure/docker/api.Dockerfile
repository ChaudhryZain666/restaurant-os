# Development image — runs the API with hot reload (tsx watch).
# A separate multi-stage production Dockerfile (build once, run compiled dist/,
# no dev deps) is future work once there's an actual deployment target.
FROM node:22-slim

WORKDIR /repo

# Full monorepo context is needed so npm workspaces can resolve internal
# package deps (@restaurant/types, @restaurant/validation, ...).
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/validation/package.json packages/validation/package.json
COPY packages/utils/package.json packages/utils/package.json
RUN npm install

COPY packages ./packages
COPY apps/api ./apps/api

RUN npm run build:packages

EXPOSE 4000
CMD ["npm", "run", "dev", "-w", "apps/api"]
