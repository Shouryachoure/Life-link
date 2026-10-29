# ==============================================================================
# LifeLink India — Backend Production Dockerfile (Multi-Stage Node 20 Alpine)
# ==============================================================================

# Stage 1: Build & Dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package manifests
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies including devDependencies for build
RUN npm ci

# Copy TypeScript source code
COPY tsconfig.json ./
COPY src ./src

# Generate Prisma Client & compile TypeScript
RUN npx prisma generate
RUN npm run build

# Prune devDependencies to keep production layer lean
RUN npm prune --production

# ------------------------------------------------------------------------------
# Stage 2: Minimal Production Runtime
# ------------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Install curl for container health check
RUN apk add --no-cache curl

ENV NODE_ENV=production
ENV PORT=5000

# Create uploads directory and set permissions
RUN mkdir -p /app/uploads && chown -R node:node /app

# Copy production artifacts from builder
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/package*.json ./

# Switch to unprivileged non-root user
USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:5000/api/v1/health || exit 1

CMD ["node", "dist/server.js"]
