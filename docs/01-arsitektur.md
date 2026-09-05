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
| `POST` | `/webhooks/ses` | Penerima notifikasi pemantulan, keluhan, buka, klik, dan balasan |

Dua endpoint terakhir tidak boleh berada di balik autentikasi. Tautan berhenti
berlangganan yang mengharuskan penerima masuk akun sama saja dengan tidak
menyediakannya.

Keduanya tiba tanpa konteks pelanggan, sehingga masing-masing menemukan
pemiliknya sendiri lewat fungsi `SECURITY DEFINER` di migrasi 010 — token
berhenti berlangganan, atau `message_id` notifikasi.

### Sesi

| Metode | Jalur | Fungsi |
|---|---|---|
| `POST` | `/auth/login` | Masuk, memasang cookie sesi `HttpOnly` |
| `POST` | `/auth/logout` | Keluar, mencabut sesi |
| `GET` | `/auth/me` | Pengguna, pelanggannya, dan status impersonasi |

### Kendali superadmin

Seluruh jalur `/admin/*` menuntut peran `superadmin`, dan ditolak dengan
**404** — bukan 403 — untuk pengguna lain: balasan 403 memberi tahu bahwa
endpoint-nya ada.

| Metode | Jalur | Fungsi |
|---|---|---|
| `GET` | `/admin/tenants` | Seluruh pelanggan beserta angka 7 hari |
| `POST` | `/admin/tenants` | Buat pelanggan + admin pertamanya |
| `PATCH` | `/admin/tenants/:id` | Ubah nama, kuota kontak, catatan |
| `POST` | `/admin/tenants/:id/bekukan` | Hentikan pengiriman, cabut sesi (alasan wajib) |
| `POST` | `/admin/tenants/:id/aktifkan` | Cabut pembekuan |
| `POST` | `/admin/tenants/:id/nonaktifkan` | Tutup akses masuk |
| `GET` | `/admin/tenants/:id/pengguna` | Pengguna pelanggan |
| `POST` | `/admin/tenants/:id/pengguna` | Tambah admin atau operator |
| `POST` | `/admin/pengguna/:id/aktif` | Hidupkan/matikan pengguna |
| `POST` | `/admin/pengguna/:id/sandi` | Setel ulang kata sandi |
| `GET` | `/admin/tenants/:id/pratinjau` | Lihat data pelanggan — **tercatat di audit** |
| `POST` | `/admin/impersonasi` | Masuk sebagai pelanggan |
| `POST` | `/admin/impersonasi/keluar` | Kembali ke kendali superadmin |
| `GET` | `/admin/audit` | Jejak tindakan superadmin |

Superadmin yang belum memilih pelanggan **tidak dapat** menyentuh rute data
pelanggan: balasannya 409 `pilih_pelanggan`. Konteksnya melewati penyaringan
Row Level Security, jadi `GET /contacts` akan menjawab gabungan seluruh
pelanggan — angka yang akan terbaca sebagai angka satu pelanggan. Jalannya
dipersempit: kendali lintas pelanggan lewat `/admin/*`, melihat data satu
pelanggan lewat impersonasi yang tercatat.

### Jalan masuk pertama

Instalasi baru tidak punya pengguna, dan tidak ada endpoint yang membuat
superadmin pertama — endpoint semacam itu harus terbuka tanpa autentikasi
supaya dapat dipakai, dan itu satu permintaan HTTP dari pengambilalihan penuh.
Yang dipakai adalah baris perintah:

```bash
cd apps/api
npm run pengguna -- superadmin lathif@contoh.id "Lathif"
npm run pengguna -- admin bawaan admin@pelanggan.id "Admin Pelanggan"
npm run pengguna -- sandi lathif@contoh.id      # setel ulang
```

Sandi yang tidak diisi dibuat acak dan ditampilkan sekali.

## Pekerjaan terjadwal

| Pekerjaan | Frekuensi | Tugas |
|---|---|---|
| `send-worker` | Tiap menit | Ambil antrean, kirim sesuai batas harian |
| `verify-worker` | Tiap 5 menit | Verifikasi alamat karantina |
| `warmup-advance` | Harian | Naikkan tahap pemanasan bila metrik sehat |
| `health-recalc` | Tiap jam | Hitung ulang bounce dan keluhan |
| `followup-enroll` | Tiap 10 menit | Daftarkan penerima yang bereaksi ke kampanye lanjutan |
| `engagement-recalc` | Tiap jam | Nilai ulang `contacts.respons` dari event pengiriman |
| `retention-sweep` | Bulanan | Laporkan kontak tanpa respons (penghapusan tetap manual) |
| `sesi-sweep` | Tiap jam | Buang sesi kedaluwarsa |

Seluruh pekerjaan yang menyentuh data pelanggan dibungkus `perTenant`, yang
menjalankannya sekali per pelanggan di dalam konteks masing-masing. Pilihan
daftarnya menentukan perilaku pembekuan: pekerjaan yang menghasilkan email
memakai `tenantAktif()` sehingga pelanggan yang dibekukan benar-benar berhenti
mengirim, sementara pekerjaan yang hanya menghitung memakai `tenantHidup()` —
pembekuan menghentikan pengiriman, bukan pembukuan.

`sesi-sweep` satu-satunya yang tidak per pelanggan: tabel `sessions` berada di
luar penyaringan tenant, karena ialah yang menetapkan tenant.

`warmup-advance` hanya menaikkan tahap kalau metrik dalam batas aman. Kalau
bounce naik, tahap ditahan atau diturunkan — kenaikan tidak boleh otomatis
hanya karena hari berganti.
