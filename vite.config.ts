import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'


import type { ServerResponse } from 'node:http'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3000'

/**
 * Bentuk minimal dari proxy milik Vite — hanya yang benar-benar dipakai di
 * bawah. Vite membungkus `http-proxy` tapi tidak mengekspor tipenya, dan
 * paket `@types/http-proxy` tidak terpasang; mendeklarasikannya di sini lebih
 * murah daripada menambah dependensi demi dua pemanggilan.
 */
interface ProxyEvents {
  on(
    event: 'error',
    listener: (err: NodeJS.ErrnoException, req: unknown, res: ServerResponse | undefined) => void,
  ): void
  on(event: 'proxyRes', listener: () => void): void
}

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id: string) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(rootDir, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(rootDir, './src'),
    },
  },

  // Dev server meneruskan /api ke Fastify supaya tidak ada urusan CORS, dan
  // supaya jalur yang dipakai saat pengembangan sama dengan saat produksi.
  server: {
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api/, ''),

        // Tanpa ini, API yang mati muncul sebagai `ECONNREFUSED` di terminal
        // dan 500 tanpa penjelasan di browser. Keduanya tidak memberi tahu
        // apa yang harus dilakukan — dan yang harus dilakukan hampir selalu
        // sama: jalankan API-nya.
        configure(proxy: ProxyEvents) {
          let sudahDiberitahu = false

          // Disetel ulang begitu API merespons lagi, supaya kalau nanti mati
          // untuk kedua kalinya penjelasannya muncul lagi — bukan sekali
          // seumur sesi.
          proxy.on('proxyRes', () => {
            sudahDiberitahu = false
          })

          proxy.on('error', (err, _req, res) => {
            const mati = err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET'

            if (mati && !sudahDiberitahu) {
              sudahDiberitahu = true
              console.log(
                `\n  API di ${API_TARGET} tidak merespons.\n` +
                  `  Jalankan di terminal terpisah:\n\n` +
                  `      npm run dev:db     # PostgreSQL lewat Docker\n` +
                  `      npm run dev:api    # migrasi + server API\n\n` +
                  `  Layar impor, kontak, dan daftar suppres membaca data dari sana,\n` +
                  `  jadi ketiganya akan kosong sampai API hidup.\n`,
              )
            }

            // `res` bisa berupa socket mentah pada permintaan WebSocket.
            if (!res || !('writeHead' in res) || res.headersSent) return

            res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(
              JSON.stringify({
                error: mati
                  ? `Server API tidak berjalan di ${API_TARGET}. Jalankan "npm run dev:api" di terminal terpisah.`
                  : `Gagal menghubungi server API: ${err.message}`,
              }),
            )
          })
        },
      },
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
