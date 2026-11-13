# syntax=docker/dockerfile:1.7
#
# EventDesk.ro images — one Dockerfile, three targets (Q7: one web service, one worker):
#
#   docker build --target web    -t <registry>/web:<tag>    --build-arg APP_VERSION=<tag> .
#   docker build --target worker -t <registry>/worker:<tag> --build-arg APP_VERSION=<tag> .
#   docker build --target public -t <registry>/public:<tag> \
#     --build-arg NEXT_PUBLIC_APP_URL=https://app.<domain> --build-arg NEXT_PUBLIC_SITE_URL=https://<domain> .
#
# - web:    apps/web as a Next.js standalone server (app.<domain>, media.<domain>, /mcp)
# - worker: apps/worker (tsx) with the whole workspace source. It is also the "tools" image:
#           `pnpm db:migrate` and the backup / restore-test scripts run in it.
# - public: apps/public static export served by Caddy (the apex domain; no cookies — D1)
#
# No secret is baked into any layer: every value arrives as an environment variable at run
# time (SEC13). All three run as a non-root user and have a HEALTHCHECK.

ARG NODE_IMAGE=node:22-alpine
ARG CADDY_IMAGE=caddy:2-alpine

# ── base: Node 22 + the pnpm version pinned in package.json ──────────────────
FROM ${NODE_IMAGE} AS base
# Keep in step with "packageManager" in package.json. Installed globally (not through
# corepack) so the unprivileged runtime user never has to download it.
ARG PNPM_VERSION=10.28.0
ENV NEXT_TELEMETRY_DISABLED=1 CI=1
RUN npm install --global --no-audit --no-fund "pnpm@${PNPM_VERSION}"
WORKDIR /repo

# ── deps: full workspace install (cached on the lockfile) ────────────────────
# One COPY per workspace package: add a line here when a package or app is added.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/public/package.json apps/public/
COPY apps/worker/package.json apps/worker/
COPY packages/auth/package.json packages/auth/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/email/package.json packages/email/
COPY packages/i18n/package.json packages/i18n/
COPY packages/jobs/package.json packages/jobs/
COPY packages/mcp/package.json packages/mcp/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store

# ── source: the repository on top of the installed dependencies ──────────────
FROM deps AS source
COPY . .

# ── build-web: next build with standalone output ─────────────────────────────
FROM source AS build-web
ENV NODE_ENV=production NEXT_OUTPUT=standalone
RUN pnpm --filter @ed/web build
# PDFs (briefings) embed DejaVu fonts; pnpm keeps them behind symlinks, so copy the real files.
RUN mkdir -p /fonts && cp -L packages/core/node_modules/dejavu-fonts-ttf/ttf/*.ttf /fonts/

# ── build-public: static export of the public site, with the D1 gate ─────────
FROM source AS build-public
# The static site bakes these two origins in at build time (they are not secrets). When an
# argument is not given, the site's own defaults apply (apps/public/lib/site.ts).
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SITE_URL
ENV NODE_ENV=production
RUN [ -n "$NEXT_PUBLIC_APP_URL" ] || unset NEXT_PUBLIC_APP_URL; \
    [ -n "$NEXT_PUBLIC_SITE_URL" ] || unset NEXT_PUBLIC_SITE_URL; \
    pnpm --filter @ed/public build && node scripts/check-public-d1.mjs

# ── web ──────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS web
ARG APP_VERSION=dev
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 HOSTNAME=0.0.0.0 \
    APP_VERSION=${APP_VERSION} \
    PDF_FONT_DIR=/app/fonts
# poppler's pdftoppm: page previews of uploaded PDF drawings (PDF_RASTERISER_BIN)
RUN apk add --no-cache poppler-utils
WORKDIR /app
COPY --from=build-web --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build-web --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build-web --chown=node:node /repo/apps/web/public ./apps/web/public
COPY --from=build-web --chown=node:node /fonts ./fonts
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ── worker (and tools: migrations, backups) ──────────────────────────────────
FROM base AS worker
ARG APP_VERSION=dev
# pg_dump/pg_restore 16 (must match the server), age (backup encryption, SEC9), aws-cli
# (any S3-compatible backup bucket), bash (pipefail in the scripts), poppler (PDF previews).
RUN apk add --no-cache postgresql16-client age aws-cli bash poppler-utils
ENV NODE_ENV=production APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=source --chown=node:node /repo ./
# The worker has no HTTP surface: "healthy" = its node process is running. Queue health
# (depth, error rate) is measured by the worker itself and shown in the console (LAU5).
USER node
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD pgrep -f "src/index.ts" >/dev/null || exit 1
CMD ["pnpm", "--filter", "@ed/worker", "run", "start"]

# ── public (static site) ─────────────────────────────────────────────────────
FROM ${CADDY_IMAGE} AS public
COPY infra/docker/public.Caddyfile /etc/caddy/Caddyfile
COPY --from=build-public /repo/apps/public/out /srv
# Unprivileged: 65532 can bind 8080 and read /srv; caddy's own state goes to /tmp.
ENV XDG_DATA_HOME=/tmp XDG_CONFIG_HOME=/tmp
USER 65532:65532
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
