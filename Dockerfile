# Build stage
# Pin to specific SHA for supply chain security
FROM node:24-slim@sha256:0afb7822fac7bf9d7c1bf3b6e6c496dee6b2b64d8dfa365501a3c68e8eba94b2 AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy config files
COPY tsconfig.json ./

# Copy source files
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Prune to production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Production stage - distroless for minimal attack surface
# Uses nonroot user (UID 65532) by default
# Pin to specific SHA for supply chain security
FROM gcr.io/distroless/nodejs24-debian12:nonroot@sha256:f9d553b602abd9cd8790ffd1259229dd9915bd293402e88339e335465fec76ac

WORKDIR /app

# Copy built files and production dependencies from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Set environment variables
ENV NODE_ENV=production
# Increase Node.js heap size to utilize container memory
ENV NODE_OPTIONS="--max-old-space-size=384"

# Health check using exec form (no shell required in distroless)
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
  CMD ["/nodejs/bin/node", "dist/healthcheck.js"]

# Explicit non-root user (distroless:nonroot uses UID 65532)
# This satisfies security scanners that require explicit USER directive
USER nonroot

# Start the bot (distroless uses node as entrypoint)
CMD ["dist/index.js"]
