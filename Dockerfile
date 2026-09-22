FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY index.html ./
COPY src ./src
COPY public ./public
COPY scripts/copy-maplibre-worker.mjs ./scripts/copy-maplibre-worker.mjs
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3210
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts/lib ./scripts/lib
COPY schemas ./schemas
COPY config ./config
COPY data ./data
COPY russiantrustedca.pem ./russiantrustedca.pem
USER node
EXPOSE 3210
CMD ["node", "server/index.js"]
