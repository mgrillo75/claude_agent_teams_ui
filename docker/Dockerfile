# =============================================================================
# Agent Teams standalone Docker image
#
# Runs the HTTP server without Electron, serving the full UI over HTTP.
# Mount your ~/.claude directory to make session data available.
#
# Build:  docker build -t agent-teams-ai .
# Run:    docker run -p 3456:3456 -v ~/.claude:/data/.claude:ro agent-teams-ai
# =============================================================================

ARG NODE_VERSION=24.16.0

FROM node:${NODE_VERSION}-slim AS base

WORKDIR /app

# Enable corepack for pnpm
RUN corepack enable

FROM base AS builder

# Native dependencies such as node-pty may need source builds on slim images.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies first (better layer caching)
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN AGENT_TEAMS_DISABLE_SOURCEMAPS=1 pnpm standalone:build

# =============================================================================
# Production dependencies stage
# =============================================================================
FROM base AS prod-deps

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install production-only dependencies
# (fastify, @fastify/cors, @fastify/static are externalized from the bundle)
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile --prod --ignore-scripts \
  && pnpm rebuild node-pty cpu-features ssh2

# =============================================================================
# Production stage - minimal image with only runtime dependencies and built output
# =============================================================================
FROM base

COPY --from=prod-deps /app/package.json /app/pnpm-lock.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/agent-teams-controller ./agent-teams-controller

# Copy built standalone server and renderer output
COPY --from=builder /app/dist-standalone ./dist-standalone
COPY --from=builder /app/out/renderer ./out/renderer

# Create data directory for Claude session mount
RUN mkdir -p /data/.claude

ENV NODE_ENV=production
ENV CLAUDE_ROOT=/data/.claude
ENV HOST=0.0.0.0
ENV PORT=3456

EXPOSE 3456

CMD ["node", "dist-standalone/index.cjs"]
