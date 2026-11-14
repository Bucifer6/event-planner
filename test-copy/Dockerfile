# TEST COPY ONLY — a private preview of EventDesk on your own computer. Not for production.
# Builds the app the same way it is built and tested in development: install, build, start.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
ENV NODE_ENV=production \
    APP_URL=http://localhost:3000 \
    PUBLIC_URL=http://localhost:3000 \
    MEDIA_URL=http://localhost:3000 \
    DATABASE_URL=postgresql://ed:ed@postgres:5432/eventdesk_test \
    SESSION_SECRET=test-copy-only-not-a-real-secret-0000000000000000 \
    EMAIL_PROVIDER=dev \
    MALWARE_SCANNER=dev \
    STORAGE_DIR=/data/files \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @ed/web build
EXPOSE 3000
CMD ["sh", "-c", "pnpm db:migrate && pnpm db:seed && pnpm --filter @ed/web start"]
