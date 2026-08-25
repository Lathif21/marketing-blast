# 01 — Arsitektur

## Susunan

```
Browser (React SPA)
        │  REST + JSON
        ▼
API server (Node.js / Fastify)
        │
        ├── PostgreSQL          data kontak, kampanye, penekanan
        ├── Worker terjadwal    antrean kirim, verifikasi, retensi
        ├── Amazon SES          pengiriman + webhook pemantulan
        └── Layanan verifikasi  pengecekan alamat sebelum kirim
```

Semua berjalan di satu VPS melalui Docker Compose.

## Keputusan teknis dan alasannya

### Antrean memakai tabel PostgreSQL, bukan Redis

Volume nyata berada di kisaran ratusan sampai belasan ribu email per bulan.
Pada skala itu tabel `job_queue` dengan worker yang melakukan polling sudah
memadai, dan Redis hanya menambah satu layanan lagi yang harus dipantau serta
diamankan oleh satu orang yang sama.

Redis ditambahkan hanya kalau volume benar-benar menuntutnya. Desain tabel
tidak perlu berubah saat itu terjadi.

### Amazon SES, bukan penyedia dengan fitur lengkap

SES paling murah dan tanpa biaya minimum bulanan, tetapi tidak menyediakan
penyusun kampanye, manajemen kontak, maupun penanganan berhenti berlangganan.
Ketiganya justru bagian yang kita bangun sendiri dan menjadi produk — jadi
membayar penyedia lain untuk fitur yang tetap kita tulis ulang tidak masuk akal.

Konsekuensi: penanganan pemantulan dan keluhan lewat webhook SES adalah
pekerjaan kita, bukan bawaan. Ini bukan detail kecil — lihat
[04-aturan-kepatuhan.md](04-aturan-kepatuhan.md).

### Domain pengirim terpisah dari domain perusahaan

Kampanye dikirim dari subdomain khusus, tidak pernah dari domain yang dipakai
korespondensi sehari-hari. Kalau reputasi pengirim jatuh, email operasional
perusahaan tidak ikut terbawa.

Konfigurasi wajib sebelum pengiriman pertama: SPF, DKIM, DMARC.

## Struktur repo yang disarankan

```
marketing-blast/
├─ apps/
│  ├─ web/                 React SPA — sudah ada dari prototype
│  └─ api/                 Fastify + worker
├─ packages/
│  └─ shared/              Tipe TypeScript yang dipakai bersama
├─ docs/                   Dokumen ini
└─ docker-compose.yml
```

Prototype saat ini menaruh seluruh UI dalam satu berkas `App.tsx` sepanjang
1.350 baris. Sebelum backend disambungkan, pecah dulu:

```
apps/web/src/
├─ screens/          Dashboard, Import, Contacts, Builder, Report, Suppression
├─ components/       StatusBadge, StepBar, DomainHealthPanel, Th
├─ lib/api.ts        Pemanggilan API terpusat
└─ lib/types.ts      Tipe bersama
```

Data tiruan (`CAMPAIGNS`, `CONTACTS`, `SUPPRESSION`, `DOMAIN`) dipindahkan ke
`lib/mock.ts` supaya jelas mana yang harus diganti panggilan API.

## Endpoint API

| Metode | Jalur | Fungsi |
|---|---|---|
| `POST` | `/imports` | Unggah berkas, kembalikan `batch_id` dan pratinjau |
| `POST` | `/imports/:id/mapping` | Simpan pemetaan kolom, jalankan validasi |
| `POST` | `/imports/:id/commit` | Simpan baris yang lolos |
| `DELETE` | `/imports/:id` | Batalkan batch, hapus kontak asalnya |
| `GET` | `/contacts` | Daftar berpaginasi, filter status dan sumber izin |
| `POST` | `/campaigns` | Buat draf |
| `POST` | `/campaigns/:id/preflight` | Periksa kepatuhan sebelum kirim |
| `POST` | `/campaigns/:id/send` | Masukkan ke antrean |
| `GET` | `/campaigns/:id/report` | Funnel dan dampak reputasi |
| `GET` | `/domain/health` | Bounce, keluhan, tahap pemanasan |
| `GET` | `/suppression` | Daftar penekanan, hanya baca |
| `GET` | `/unsubscribe/:token` | Publik, tanpa autentikasi |
| `POST` | `/webhooks/ses` | Penerima notifikasi pemantulan dan keluhan |

Dua endpoint terakhir tidak boleh berada di balik autentikasi. Tautan berhenti
berlangganan yang mengharuskan penerima masuk akun sama saja dengan tidak
menyediakannya.

## Pekerjaan terjadwal

| Pekerjaan | Frekuensi | Tugas |
|---|---|---|
| `send-worker` | Tiap menit | Ambil antrean, kirim sesuai batas harian |
| `verify-worker` | Tiap 5 menit | Verifikasi alamat karantina |
| `warmup-advance` | Harian | Naikkan tahap pemanasan bila metrik sehat |
| `health-recalc` | Tiap jam | Hitung ulang bounce dan keluhan |
| `retention-sweep` | Bulanan | Hapus kontak tanpa respons sesuai kebijakan |

`warmup-advance` hanya menaikkan tahap kalau metrik dalam batas aman. Kalau
bounce naik, tahap ditahan atau diturunkan — kenaikan tidak boleh otomatis
hanya karena hari berganti.
