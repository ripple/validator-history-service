# Multi-stage Dockerfile for validator-history-service
# Optimized for Antithesis testing platform

# Stage 1: Build stage
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig*.json ./

# Install dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY src ./src
COPY bin ./bin

# Build TypeScript code
RUN npm run build

# Stage 2: Production stage
FROM node:20-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init bash

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/build ./build
COPY --from=builder /app/bin ./bin

# Create directory for Antithesis test templates and copy test script
RUN mkdir -p /opt/antithesis/test/v1/quickstart
COPY antithesis/test_template.sh /opt/antithesis/test/v1/quickstart/singleton_driver_vhs_test.sh
RUN chmod +x /opt/antithesis/test/v1/quickstart/singleton_driver_vhs_test.sh

# Set environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    ADDR=0.0.0.0

# Expose port 3000 for the API
EXPOSE 3000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Default command - can be overridden with --api, --connections, or --crawler
CMD ["node", "build/index.js", "--api"]

# Health check for the API service
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/v1/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

# Labels for documentation
LABEL org.opencontainers.image.title="Validator History Service" \
      org.opencontainers.image.description="Service for ingesting, aggregating, storing, and disbursing validation related data" \
      org.opencontainers.image.vendor="Ripple" \
      org.opencontainers.image.source="https://github.com/ripple/validator-history-service"
