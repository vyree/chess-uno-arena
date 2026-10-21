# Chess + UNO Arena — WebSocket game server for Cloud Run (Fase 4).
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY game ./game
COPY public ./public
ENV NODE_ENV=production
# Cloud Run injects PORT; server.js already honors it (default 3000).
CMD ["node", "server.js"]
