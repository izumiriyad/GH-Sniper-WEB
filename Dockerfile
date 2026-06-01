# GHSniper Web v4 — Multi-stage Docker build
# Stage 1: Build TypeScript
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# Stage 2: Production
FROM node:20-slim AS production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY public/ ./public/
COPY ecosystem.config.js ./

# Create data directory for SQLite
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

EXPOSE 3000

# Start with GC exposed and memory limits
CMD ["node", "--expose-gc", "--max-old-space-size=512", "dist/server.js"]
