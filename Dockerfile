FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg sqlite3 fonts-noto-cjk fonts-dejavu-core ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
FROM base AS builder
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run typecheck && npm run build
FROM base AS runtime
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/bin ./bin
RUN mkdir -p output data assets/characters assets/locations assets/bgm
EXPOSE 3456
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl -f http://localhost:3456/health || exit 1
CMD ["node","dist/apps/cli/main.js","series:studio","--host","127.0.0.1","--no-open"]
