# Satu image berisi frontend DAN API, disajikan dari satu proses di satu port.
#
# Ini bukan penyederhanaan demi kepraktisan. Cookie sesi memakai `SameSite=Lax`
# (apps/api/src/auth/plugin.ts), yang menolak dikirim lintas situs — frontend
# di domain lain akan berhasil login lalu kehilangan sesinya pada permintaan
# berikutnya. Menyatukan origin menghilangkan persoalan itu, alih-alih
# melonggarkan cookie dan CORS untuk menyiasatinya.
#
# docker-compose.yml TIDAK memakai berkas ini; di sana frontend dan API memang
# dipisah. Ini untuk host satu-service seperti Railway, Render, atau Fly.

# ─── Frontend ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS web
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts postcss.config.mjs index.html ./
COPY src ./src
# VITE_API_URL sengaja tidak diisi: nilai bawaannya `/api` (src/app/lib/api.ts),
# dan `/api` pada origin yang sama persis seperti yang dilayani server di
# bawah. Mengisinya dengan URL absolut justru mengembalikan masalah lintas situs
# yang image ini dibuat untuk menghindarinya.
RUN npm run build

# ─── API ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS api
WORKDIR /api
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci
COPY apps/api/tsconfig.json ./
COPY apps/api/src ./src
RUN npm run build

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=api /api/dist ./dist
# Runner migrasi membaca berkas SQL saat dijalankan, bukan saat build.
COPY apps/api/migrations ./migrations
COPY --from=web /web/dist ./public

# Dibaca config.ts. Selama terisi, proses ini ikut menyajikan frontend.
ENV STATIC_DIR=/app/public

# Outbox driver dummy ditulis oleh proses non-root, jadi direktorinya harus
# sudah ada dan dimiliki user `node`.
RUN mkdir -p /app/var/outbox && chown -R node:node /app/var
USER node

EXPOSE 3000

# Migrasi lebih dulu, lalu server — sama seperti `npm run dev:api` di lokal.
# Kalau migrasi gagal, proses berhenti di sini dan server tidak pernah start:
# lebih baik daripada server hidup di atas skema yang tidak sesuai.
CMD ["sh", "-c", "node dist/migrate.js && node dist/server.js"]
