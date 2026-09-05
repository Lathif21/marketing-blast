# 02 — Model Data

## Multi-tenant

Satu instalasi melayani banyak pelanggan. Setiap tabel data pelanggan memuat
`tenant_id`, dan penyaringannya **tidak** diserahkan ke query.

| Lapisan | Yang menegakkan |
|---|---|
| Baca, ubah, hapus | Policy Row Level Security `tenant_id = app_tenant()` |
| Sisip | `DEFAULT app_tenant()` pada kolom `tenant_id` |
| Konteks koneksi | `dalamKonteks()` di `src/db.ts` menyetel `app.tenant_id` |

Akibatnya query di aplikasi tidak menyebut `tenant_id` sama sekali — bukan
karena boleh lupa, melainkan karena database yang menambahkannya. Satu
`WHERE tenant_id` yang lupa ditulis tidak menghasilkan galat, hanya kampanye
yang terkirim ke orang yang salah; itu sebabnya penjagaannya tidak boleh
tinggal di lapisan yang bisa lupa.

`query()` **melempar** bila dipanggil tanpa konteks, dan itu bagian dari
rancangannya. Alternatifnya — jatuh kembali ke kolam koneksi biasa — akan
tetap "bekerja": RLS menyembunyikan semua baris, jadi yang muncul adalah
daftar kosong. Penjagaan inilah yang menahan lubang autentikasi nyata saat
fitur ini dibangun: hook sesi sempat tidak berlaku untuk sebagian rute karena
enkapsulasi plugin Fastify, dan yang menahan permintaan tanpa sesi bukan
pemeriksaan sesi melainkan penolakan di lapisan basis data.

Tabel yang bertenant: `contacts`, `campaigns`, `campaign_recipients`,
`suppression`, `import_batches`, `domain_health`, `domain_daily_sends`.

Dua keunikan ikut berubah menjadi per pelanggan:

* `contacts` unik pada `(tenant_id, email)`. Global, pelanggan kedua yang
  mengimpor alamat yang sudah dipakai pelanggan pertama akan ditolak duplikat —
  dan pesan galatnya sendiri membocorkan bahwa alamat itu ada di sistem.
* `suppression` berkunci `(tenant_id, email)`. Satu daftar global melindungi
  reputasi lebih kuat, tapi berarti penolakan yang diterima pelanggan A
  membatasi jangkauan pelanggan B tanpa pernah disepakati siapa pun. Itu
  keputusan kontrak, bukan keputusan skema. Sifat permanennya tidak berubah.

`domain_health.domain` **tetap** unik secara global. Reputasi menempel pada
domain, jadi dua pelanggan yang mengirim dari domain yang sama akan berbagi
reputasi sekaligus melipatgandakan volume harian di belakang batas pemanasan
masing-masing.

### `tenants`

| Kolom | Keterangan |
|---|---|
| `nama`, `slug` | `slug` muncul di URL dan log |
| `status` | `aktif`, `dibekukan`, `nonaktif` |
| `kuota_kontak` | Batas jumlah kontak; `null` = tanpa batas |
| `alasan_beku`, `dibekukan_pada`, `dibekukan_oleh` | Jejak pembekuan |

Pelanggan tidak dihapus lewat aplikasi — statusnya menjadi `nonaktif`. Hak
`DELETE` pada tabel ini dicabut dari peran aplikasi: menghapusnya akan ikut
menghapus seluruh kontak, kampanye, dan jejak pengiriman lewat
`ON DELETE CASCADE`, termasuk angka pemantulan yang menjadi dasar reputasi.

### `users`, `sessions`, `admin_audit`

Ketiganya **tanpa** RLS, dan itu disengaja: merekalah yang menetapkan konteks
pelanggan. Policy `tenant_id = app_tenant()` pada `users` menghasilkan
lingkaran — konteks belum ada saat seseorang login, sehingga barisnya sendiri
tidak terlihat, sehingga login tidak pernah bisa berhasil. Penyaringannya
karena itu berada di `auth/`, dan hanya di sana.

| Tabel | Catatan |
|---|---|
| `users` | `peran`: `superadmin` (tanpa tenant), `admin`, `operator`. Sandi di-hash scrypt |
| `sessions` | Menyimpan **hash** token, bukan tokennya. `impersonasi` menunjuk pelanggan yang sedang dimasuki superadmin |
| `admin_audit` | Hanya bertambah — `UPDATE`, `DELETE`, `TRUNCATE` dicabut dari peran aplikasi |

Sesi disimpan di tabel, bukan sebagai token bertanda tangan, karena
pencabutan seketika adalah inti fitur pembekuan: pelanggan yang dibekukan
karena reputasinya rusak tidak boleh tetap bisa bekerja sampai tokennya habis
sendiri.

## Tabel

### `contacts`

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid | |
| `email` | citext | Unik. Kunci deduplikasi |
| `domain` | text | Diturunkan dari alamat |
| `company_name` | text | |
| `consent_source` | enum | Wajib. Lihat daftar di bawah |
| `consent_strength` | enum | `kuat`, `cukup`, `perlu_ditinjau` |
| `consent_date` | date | |
| `email_origin` | enum | `found`, `guessed`, `manual` |
| `status` | enum | `aktif`, `karantina`, `diblokir` |
| `reference_contact` | jsonb | Nomor telepon dan WhatsApp — rujukan saja |
| `address` | text | |
| `acquisition_note` | text | Jejak asal, misalnya kata kunci pencarian |
| `import_batch_id` | uuid | |
| `imported_at` | timestamptz | |

Nilai `consent_source`: `pelanggan_existing`, `formulir_web`, `izin_lisan`,
`pameran`, `referral`, `alamat_generik_terpublikasi`, `lainnya`.

`consent_strength` tidak memblokir pengiriman. Fungsinya memicu peringatan
pada tahap pra-kirim dan menjadi jejak audit bila di kemudian hari
dipertanyakan.

### `suppression`

| Kolom | Tipe | Keterangan |
|---|---|---|
| `email` | citext | Kunci primer |
| `reason` | enum | `unsubscribe`, `hard_bounce`, `keluhan`, `manual` |
| `created_at` | timestamptz | |

Tidak ada operasi hapus. Tidak ada endpoint hapus. Tidak ada tombol di UI.
Impor memeriksa tabel ini dan menolak alamat yang ada di dalamnya, tanpa
opsi ditimpa.

### `import_batches`

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | uuid | |
| `filename` | text | |
| `row_count` | int | |
| `accepted` / `rejected` / `quarantined` | int | |
| `consent_source` | enum | Pernyataan pengguna untuk seluruh berkas |
| `declared_by` | uuid | Pengguna yang menyatakan |
| `created_at` | timestamptz | |

Batch dapat dibatalkan sampai 30 hari. Pembatalan menghapus kontak yang
berasal darinya, kecuali yang sudah masuk daftar penekanan — alamat itu tetap
tinggal.

### `campaigns`, `campaign_recipients`

`campaign_recipients` menyimpan status per penerima: `queued`, `sent`,
`delivered`, `opened`, `clicked`, `bounced`, `complained`, ditambah
`replied_at` dan `reply_snippet` untuk balasan masuk.

`campaigns` memuat kolom tindak lanjut: `parent_campaign_id`, `pemicu`
(`membalas`, `diklik`, `dibuka`, `apa_saja`), `jeda_lanjutan_jam`, dan
`lanjutan_aktif`. Kampanye dengan induk tidak memilih penerimanya sendiri —
`filterEfektif` menambahkan kriteria "penerima induk yang bereaksi sesuai
pemicu, minimal sekian jam lalu" ke segmennya. Berantai satu tingkat saja:
tindak lanjut dari tindak lanjut ditolak endpoint.

### Penilaian respons pada `contacts`

| Kolom | Keterangan |
|---|---|
| `respons` | `belum_ada`, `menunggu`, `tertarik`, `menolak`, `diam` |
| `last_sent_at` | Pengiriman terakhir kepadanya |
| `last_engaged_at` | Reaksi terakhir: buka, klik, atau balasan |
| `respons_dinilai_pada` | Kapan `engagement-recalc` terakhir menyentuhnya |

Aturannya hidup di `campaign/engagement.ts` sebagai fungsi murni, bukan
sebagai CASE dalam SQL — `engagement-recalc` mengumpulkan faktanya di SQL lalu
memanggil fungsi itu, sehingga yang diuji adalah yang benar-benar dijalankan.

`diam` berarti tidak ada jawaban selama 30 hari, bukan penolakan. Akibatnya
sudah berjalan tanpa penghapusan apa pun: kontaknya tidak memenuhi pemicu
tindak lanjut mana pun. Penghapusannya manual, lewat
`POST /contacts/retensi/hapus`, dan tercatat atas nama siapa.

Pembukaan email hanya terdeteksi bila klien penerima memuat gambar pelacak,
dan email yang dihapus tanpa dibuka tidak meninggalkan sinyal sama sekali.
Keduanya bermuara pada `diam` — itu sebabnya `diam` tidak pernah otomatis
menjadi penghapusan.

### `domain_health`

| Kolom | Keterangan |
|---|---|
| `domain` | Domain pengirim |
| `warmup_stage` | Tahap saat ini |
| `daily_limit` | Batas hari ini |
| `sent_today` | Terpakai hari ini |
| `bounce_rate_7d` | Rata-rata bergerak |
| `complaint_rate_7d` | Rata-rata bergerak |

### `job_queue`

| Kolom | Keterangan |
|---|---|
| `id`, `job_type`, `payload` (jsonb) | |
| `status` | `pending`, `running`, `done`, `failed` |
| `scheduled_at`, `attempts`, `last_error` | |

## Integrasi Contact Harvester

Alat internal menghasilkan CSV dengan 13 kolom tetap, satu baris per
perusahaan (dikelompokkan berdasarkan host situs):

```
company, email, whatsapp, website, email_source, phone,
other_emails, other_whatsapp, address, page_type,
render_mode, search_query, status
```

Pemetaan otomatis:

| Kolom sumber | Tujuan | Catatan |
|---|---|---|
| `company` | `company_name` | Bila kosong, alat mengisinya dengan host |
| `email` | `email` | |
| `email_source` | `email_origin` | Menentukan status awal — lihat bawah |
| `website` | `domain` | Diambil host-nya |
| `other_emails` | — | Dipisah `; ` → baris karantina terpisah |
| `whatsapp`, `other_whatsapp`, `phone` | `reference_contact` | Rujukan saja |
| `address` | `address` | |
| `search_query` | `acquisition_note` | |
| `status` | — | Selain `ok` → baris ditolak |
| `page_type`, `render_mode` | — | Tidak diimpor |

### Kolom `email_source` menentukan status awal

| Nilai | Arti | Status saat impor |
|---|---|---|
| `found` | Alamat benar-benar terpublikasi di halaman perusahaan | `aktif` setelah verifikasi |
| `guessed` | Disintesis dari nama domain, misalnya `info@domain` | `karantina` |
| kosong | Tidak ada alamat | Ditolak untuk kanal email |

Alamat `guessed` adalah alamat yang belum tentu ada. Kode alat internal
sendiri menandainya secara eksplisit justru supaya dapat diperlakukan berbeda
di hilir. Ini penyebab utama pemantulan keras, dan pemantulan tinggi merusak
reputasi domain secara menular.

Aturannya: `guessed` masuk karantina, wajib lolos verifikasi alamat sebelum
aktif, dan **tidak boleh masuk kampanye pertama pada domain pengirim baru** —
saat reputasi paling rapuh.

### Berkas terenkripsi

Keluaran `.enc` berformat salt diikuti muatan Fernet, kunci diturunkan lewat
PBKDF2-HMAC-SHA256. Dekripsi dilakukan di memori; berkas terdekripsi tidak
pernah ditulis ke disk. Kegagalan karena kata sandi salah dibedakan dari
kegagalan karena berkas berubah, dan dilaporkan dengan pesan berbeda.

### Catatan integrasi

Alat internal belum menghasilkan kolom penanda izin. Selama belum ada,
Marketing Blast menurunkan aturannya dari `email_source` dan pengguna
menetapkan `consent_source` saat impor. Bila kemudian alat menambahkan kolom
penanda, kolom itu menjadi acuan utama dan menggantikan penurunan ini.
