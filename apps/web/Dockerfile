# syntax=docker/dockerfile:1
# One image for the app services (web + worker) — the deploy workflow builds exactly
# this file from the repo root: docker build -f apps/web/Dockerfile -t <image> .
# Build context MUST be the repository root.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/public/package.json apps/public/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/email/package.json packages/email/package.json
COPY packages/i18n/package.json packages/i18n/package.json
COPY packages/jobs/package.json packages/jobs/package.json
COPY packages/mcp/package.json packages/mcp/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/ui/package.json packages/ui/package.json
# the root postinstall runs `prisma generate`, so the schema must exist before install
COPY packages/db/prisma/schema.prisma packages/db/prisma/schema.prisma
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @eventdesk/db exec prisma generate
RUN pnpm build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
COPY docker-entrypoint.sh /docker-entrypoint.sh
# strip CR defensively in case the file was checked out with CRLF on Windows
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["web"]
