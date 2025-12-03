# Build stage
FROM node:20-slim AS builder

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

# Production stage
FROM node:20-slim AS production

WORKDIR /app

# Create non-root user for security
RUN groupadd -g 1001 discordbot && \
    useradd -u 1001 -g discordbot -s /bin/false discordbot

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Create logs directory
RUN mkdir -p /app/logs && chown -R discordbot:discordbot /app

# Switch to non-root user
USER discordbot

# Set environment variables
ENV NODE_ENV=production
# Increase Node.js heap size to utilize container memory
ENV NODE_OPTIONS="--max-old-space-size=384"

# Health check - verify process is responsive
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
  CMD node dist/healthcheck.js || exit 1

# Start the bot
CMD ["node", "dist/index.js"]
