FROM node:22-slim AS builder

# better-sqlite3 falls back to node-gyp when no prebuild matches; keep the
# toolchain in the builder stage only (the runner image stays clean).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY config/ ./config/
COPY data/ ./data/

EXPOSE 3000
CMD ["node", "dist/index.js"]
