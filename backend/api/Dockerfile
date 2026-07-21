# Aethelred API Gateway Dockerfile
# Multi-stage build for production

# ============ BASE ============
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS base

# Runtime packages only. Native npm modules are compiled in the dependencies
# stage so production images do not carry compilers or Python.
# openssl: required at runtime by the Prisma schema/query engines on Alpine.
RUN apk add --no-cache dumb-init curl libstdc++ openssl

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

# Install all dependencies (including dev) without dependency lifecycle hooks.
RUN npm ci --ignore-scripts

# Rebuild only audited native/runtime packages needed by the API image.
RUN npm rebuild @prisma/engines @sentry/profiling-node esbuild protobufjs

# Generate Prisma client through a trusted repository-owned script.
RUN npm run db:generate

# Install SDK build dependencies used by the API prebuild step.
WORKDIR /app/sdk/typescript
COPY sdk/typescript/package*.json ./
RUN npm ci --ignore-scripts

WORKDIR /app/backend/api

# ============ BUILDER ============
FROM dependencies AS builder

# Copy source code required for API + shared SDK builds.
COPY backend/api/ ./
COPY sdk/typescript/ /app/sdk/typescript/

# Build TypeScript
RUN npm run build

# Remove dev dependencies without running dependency lifecycle hooks.
RUN npm prune --omit=dev --ignore-scripts

# ============ DATABASE MIGRATION ============
# Dedicated immutable image that retains the Prisma CLI and checked-in
# migrations. It does not contain or start the HTTP/indexer application.
FROM dependencies AS migration

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app/backend/api

COPY backend/api/scripts/run-prisma-migrate.mjs ./scripts/run-prisma-migrate.mjs

ENV NODE_ENV=production

USER nodejs

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "scripts/run-prisma-migrate.mjs", "deploy"]

# ============ PRODUCTION ============
FROM base AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app/backend/api

# Production images must boot into the hardened config path even when they are
# run outside docker-compose.
ENV NODE_ENV=production
ENV PORT=4001

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
EXPOSE 4001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:4001/health/live || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]

# ============ INDEXER ============
FROM production AS indexer

HEALTHCHECK --interval=15s --timeout=3s --start-period=90s --retries=4 \
    CMD node dist/indexer-healthcheck.js || exit 1

CMD ["node", "dist/indexer.js"]
