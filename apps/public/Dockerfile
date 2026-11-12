# syntax=docker/dockerfile:1
# Public marketing site (eventdesk.ro): static export served by nginx. Zero cookies,
# zero third-party scripts (D1, asserted in CI on the same build output).
# Build context MUST be the repository root.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/public/package.json apps/public/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
# the root postinstall runs `prisma generate`, so the schema must exist before install
COPY packages/db/prisma/schema.prisma packages/db/prisma/schema.prisma
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @eventdesk/public-site build

FROM nginx:alpine
COPY --from=build /app/apps/public/out /usr/share/nginx/html
EXPOSE 80
