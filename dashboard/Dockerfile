# Stage 1: Build the SvelteKit application
# Pinned to specific SHA for reproducible builds - update periodically for security patches
# To get latest: docker pull node:22-slim && docker inspect node:22-slim --format='{{index .RepoDigests 0}}'
FROM node:22-slim@sha256:5c8ab72c248a05b4a293172fca2484e9baaab12aacc824e9a6a612364afb9df7 AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for building)
RUN npm ci

# Copy source code
COPY . .

# Build the SvelteKit application
RUN npm run build

# Prune dev dependencies for smaller final image
RUN npm prune --production

# Stage 2: Production image using distroless
# Pinned to specific SHA for reproducible builds - update periodically for security patches
# To get latest: docker pull gcr.io/distroless/nodejs22-debian12:nonroot && docker inspect --format='{{.RepoDigests}}'
# SECURITY: Using :nonroot tag which runs as UID 65532, not root
# NOSONAR: docker:S6471 - distroless nonroot images explicitly run as non-privileged user
FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:9187fd451b5e2d258d691cb7da51020bfc8f557cc4a58e80b38f3f30bbbc37f9

WORKDIR /app

# Copy built application and production dependencies
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Run the application (adapter-node outputs index.js in build/)
CMD ["build/index.js"]
