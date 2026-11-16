# --- Stage 1: Build dependencies ---
FROM node:22-slim AS builder

# Install build tools for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

# --- Stage 2: Runtime ---
FROM node:22-slim

WORKDIR /app

# Copy built node_modules from the builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Ensure the data directory exists for SQLite
RUN mkdir -p /app/data && chown -R node:node /app

USER node

ENV PORT=3701
EXPOSE 3701

CMD ["node", "server.js"]