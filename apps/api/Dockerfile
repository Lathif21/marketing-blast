# Satu image dipakai dua service: api dan worker. Bedanya hanya perintah start.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Outbox driver dummy ditulis oleh proses non-root, jadi direktorinya harus
# sudah ada dan dimiliki user `node` sebelum volume dipasang di atasnya.
RUN mkdir -p /app/var/outbox && chown -R node:node /app/var
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
