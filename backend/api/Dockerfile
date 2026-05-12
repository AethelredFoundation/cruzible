# Aethelred API Gateway Dockerfile
# Multi-stage build for production

# ============ BASE ============
FROM node:20-alpine AS base

# Runtime packages only. Native npm modules are compiled in the dependencies
# stage so production images do not carry compilers or Python.
RUN apk add --no-cache dumb-init curl libstdc++

WORKDIR /app

# ============ DEPENDENCIES ============
FROM base AS dependencies

WORKDIR /app/backend/api

# @sentry/profiling-node and similar native packages require node-gyp tooling
# during npm ci. Keep these build packages out of the production stage.
RUN apk add --no-cache python3 make g++

# Copy package files from the repository-root build context.
COPY backend/api/package*.json ./
COPY backend/api/prisma ./prisma/

# Install all dependencies (including dev)
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Install SDK build dependencies used by the API prebuild step.
WORKDIR /app/sdk/typescript
COPY sdk/typescript/package*.json ./
RUN npm ci

WORKDIR /app/backend/api

# ============ BUILDER ============
FROM dependencies AS builder

# Copy source code required for API + shared SDK builds.
COPY backend/api/ ./
COPY sdk/typescript/ /app/sdk/typescript/

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# ============ PRODUCTION ============
FROM base AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app/backend/api

# Production images must boot into the hardened config path even when they are
# run outside docker-compose.
ENV NODE_ENV=production
ENV PORT=3000

# Copy package files
COPY backend/api/package*.json ./

# Copy production dependencies
COPY --from=builder /app/backend/api/node_modules ./node_modules
COPY --from=builder /app/backend/api/prisma ./prisma

# Copy built application
COPY --from=builder /app/backend/api/dist ./dist
COPY --from=builder /app/sdk/typescript/dist /app/sdk/typescript/dist

# Set permissions
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/health/live || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]

# ============ INDEXER ============
FROM production AS indexer

CMD ["node", "dist/indexer.js"]
