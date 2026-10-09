# syntax=docker/dockerfile:1
# Production image for apothem-api (Render). Build: docker build -t apothem-api .
# Not built in CI yet; `npm run smoke:prod` checks the same compiled output without Docker.

FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY workers ./workers
COPY database ./database
COPY infra/scripts ./infra/scripts
COPY drizzle.config.ts vitest.config.ts vitest.mutation.config.ts ./
RUN npm run build

FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Production dependencies only: no tsx, no vitest, no stryker.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# The migration runs from the compiled output and reads these SQL files relative to the working directory.
COPY migrations ./migrations
USER node
EXPOSE 3001
# /health is liveness only (no database); /ready also checks the database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Applies pending migrations, then starts the server. Safe with the single instance this stack runs (ADR-010).
CMD ["npm", "run", "start:prod"]
