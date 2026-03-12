# Aethelred API Gateway Dockerfile
# Multi-stage build for production

# ============ BASE ============
FROM node:20-alpine AS base

# Install dependencies
RUN apk add --no-cache dumb-init curl

WORKDIR /app

# ============ DEPENDENCIES ============
FROM base AS dependencies

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including dev)
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# ============ BUILDER ============
FROM dependencies AS builder

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# ============ PRODUCTION ============
FROM base AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy production dependencies
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/prisma ./prisma

# Copy built application
COPY --from=builder /app/dist ./dist

# Set permissions
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]
