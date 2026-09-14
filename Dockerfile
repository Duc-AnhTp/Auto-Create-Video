# ══════════════════════════════════════════════════════════════════════════════
# Dockerfile for Auto-Create-Video & Episodic Film Series Web Studio
# Multi-stage production container with FFmpeg, SQLite & Vietnamese font support
# ══════════════════════════════════════════════════════════════════════════════

FROM node:22-bookworm-slim AS base

# Install FFmpeg, ffprobe, SQLite3, fonts for Vietnamese rendering, and CA certs
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    sqlite3 \
    fonts-noto-cjk \
    fonts-dejavu-core \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --include=dev

# Copy application source
COPY . .

# Ensure output, data, and asset directories exist
RUN mkdir -p output data assets/characters assets/locations assets/bgm

# Expose Web Studio port
EXPOSE 3456

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3456/health || exit 1

# Default launch command: Full-Flow Web Studio
CMD ["npm", "run", "studio"]
