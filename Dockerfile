FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY config/ ./config/
COPY data/ ./data/

EXPOSE 3000
CMD ["node", "dist/index.js"]
