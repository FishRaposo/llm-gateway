FROM node:20-alpine AS builder

WORKDIR /app
# Toolchain for native modules (better-sqlite3, bcrypt) when no prebuilt
# binary matches the platform.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY config/ ./config/
COPY data/ ./data/

EXPOSE 3000
CMD ["node", "dist/index.js"]
