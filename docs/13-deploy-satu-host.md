# 13 — Deploy satu host (frontend + API satu origin)

Untuk demo yang dapat dibuka orang lain tanpa menjalankan apa pun di mesin
sendiri. Seluruh sistem berjalan sebagai satu service di satu domain.

## Mengapa satu origin, bukan frontend di Vercel dan API di tempat lain

Godaannya jelas: frontend statis sangat murah di Vercel, tinggal arahkan
`VITE_API_URL` ke API di host lain. Susunan itu gagal karena dua hal yang
memang sengaja dibuat ketat:

1. **Cookie sesi memakai `SameSite=Lax`** (`apps/api/src/auth/plugin.ts`). Lax
   menolak dikirim lintas situs. Login akan membalas 200, lalu permintaan
   berikutnya datang tanpa cookie dan dijawab 401. Dari sisi pengguna itu
   terlihat seperti aplikasi yang rusak acak, bukan seperti salah konfigurasi.
2. **Tidak ada CORS** — `server.ts` tidak mendaftarkan `@fastify/cors`, jadi
   browser memblokir permintaan lintas domain sebelum sampai ke server.

Keduanya dapat dilonggarkan: `SameSite=None; Secure` plus allowlist CORS plus
`credentials: "include"` di setiap fetch. Hasil akhirnya sama dengan menyatukan
origin, tetapi dengan menukar satu lapis pertahanan CSRF demi kenyamanan
hosting. Menyatukan origin lebih murah dan tidak menukar apa pun.

## Yang membuatnya bekerja

Dua bagian kecil, keduanya tidak aktif selama `STATIC_DIR` kosong:

| Bagian | Berkas | Peran |
|---|---|---|
| `rewriteUrl` | `apps/api/src/server.ts` | Melucuti prefiks `/api` sebelum perutean — pengganti proxy dev server Vite, yang tidak ikut ter-build |
| `@fastify/static` | `apps/api/src/server.ts` | Menyajikan `STATIC_DIR` ketika terisi |
| Cangkang publik | `apps/api/src/auth/plugin.ts` | `/`, `/index.html`, `/assets/*` terbuka tanpa sesi — hanya saat `STATIC_DIR` terisi |

Yang terbuka tanpa sesi hanya cangkangnya: HTML, JS, CSS yang sama untuk setiap
pengunjung. Seluruh rute data tetap dijaga persis seperti sebelumnya.

## Langkah

Prasyarat: host yang bisa menjalankan container (Railway, Render, Fly.io) dan
satu Postgres terkelola.

**1. Siapkan Postgres.** Catat connection string-nya. Di Railway dan Render,
menambahkan Postgres akan memunculkan variabel semacam `DATABASE_URL` otomatis.

**2. Buat service dari repo ini** dengan `Dockerfile` di akar repo (bukan
`apps/api/Dockerfile` — yang itu untuk `docker-compose`, di mana frontend dan
API memang dipisah).

**3. Isi variabel lingkungan** di dashboard host. Minimum agar proses mau start:

```
DATABASE_URL           postgres://...      # pemilik skema, dipakai migrasi
APP_DB_PASSWORD        <acak, 32+ karakter>
UNSUBSCRIBE_SECRET     <openssl rand -hex 32>
PUBLIC_BASE_URL        https://<domain-demo-anda>
MAIL_DRIVER            dummy
```

`APP_DATABASE_URL` sebaiknya juga diisi — tanpa itu aplikasi terhubung sebagai
pemilik skema dan larangan `DELETE` pada tabel `suppression` tidak aktif. Proses
memperingatkannya saat start, tidak mendiamkannya.

`STATIC_DIR` dan `PORT` sudah diatur di dalam image; tidak perlu diisi.

**Jangan** isi `MAIL_DRIVER=ses` sebelum seluruh prasyarat di
`docs/08-amazon-ses.md` terpenuhi. Proses akan gagal start, bukan diam-diam
tidak mengirim — dan itu memang perilaku yang diinginkan.

**4. Deploy.** Container menjalankan migrasi lebih dulu, lalu server. Migrasi
yang gagal menghentikan proses sebelum server hidup.

**5. Buat akun pertama.** Instalasi baru tidak punya pengguna, dan seluruh rute
menuntut sesi — jadi tanpa langkah ini tidak ada yang bisa masuk. Jalankan lewat
shell milik host:

```bash
node dist/scripts/pengguna.js superadmin <email> "<Nama>"
```

Sandi akan dibuat acak dan ditampilkan sekali. Ini sengaja baris perintah, bukan
endpoint "buat superadmin pertama": endpoint semacam itu harus terbuka tanpa
autentikasi untuk dapat dipakai, dan endpoint terbuka yang membuat superadmin
adalah satu permintaan HTTP dari pengambilalihan penuh.

**6. Periksa.** `GET /health` membalas status database dan driver email yang
sedang aktif.

## Memeriksa hasilnya

```bash
curl -s https://<domain>/health
curl -s -o /dev/null -w "%{http_code}\n" https://<domain>/          # 200
curl -s -o /dev/null -w "%{http_code}\n" https://<domain>/api/contacts  # 401
```

Baris ketiga yang terpenting: rute data harus tetap 401 tanpa sesi. Kalau ia
membalas 200, penjagaan sesi bocor dan demo tidak boleh dibuka ke publik.
