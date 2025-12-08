# Stage 1: Build the SvelteKit application
FROM node:22-slim AS builder

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
FROM gcr.io/distroless/nodejs22-debian12:nonroot

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
