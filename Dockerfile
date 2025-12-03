# Build stage
FROM node:24-slim AS builder

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
FROM gcr.io/distroless/nodejs24-debian12:nonroot

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

# Start the bot (distroless uses node as entrypoint)
CMD ["dist/index.js"]
