# 02 — Model Data

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

Standar. `campaign_recipients` menyimpan status per penerima: `queued`,
`sent`, `delivered`, `opened`, `clicked`, `bounced`, `complained`.

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
