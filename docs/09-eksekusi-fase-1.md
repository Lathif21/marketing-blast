# 09 — Eksekusi Fase 1

Runbook untuk dikerjakan sambil menunggu persetujuan keluar sandbox SES.
Tidak ada satu pun tugas di sini yang membutuhkan SES aktif.

## Urutan dan ketergantungan

```
1. Migrasi + skema          ← memblokir semua yang lain
        │
        ├── 2. Penekanan & berhenti berlangganan
        │
        └── 3. Impor kontak
                    │
                    └── 4. Sambungkan layar ke API
```

Kerjakan berurutan. Nomor 2 didahulukan dari 3 bukan karena lebih mudah,
tapi karena mekanisme berhenti berlangganan yang menyusul belakangan cenderung
tidak pernah benar-benar diuji.

---

## Tugas 1 — Migrasi dan skema

Belum ada satu pun berkas SQL di repo. Ini yang menahan seluruh Fase 1.

### Pendekatan

Jangan tambah dependensi. Berkas SQL bernomor plus satu runner kecil sudah
cukup, dan konsisten dengan prinsip menjaga jumlah komponen tetap sedikit.

```
apps/api/
├─ migrations/
│  ├─ 001_extensions.sql
│  ├─ 002_contacts.sql
│  ├─ 003_suppression.sql
│  ├─ 004_import_batches.sql
│  └─ 005_job_queue.sql
└─ src/migrate.ts
```

Runner mencatat berkas yang sudah dijalankan di tabel `schema_migrations`,
menjalankan yang belum, satu transaksi per berkas. Tambahkan skrip
`"migrate": "node dist/migrate.js"` di `apps/api/package.json`, dan panggil
sebelum `start` di Docker Compose.

### 001_extensions.sql

```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

`citext` supaya `Info@Domain.com` dan `info@domain.com` dihitung satu alamat.
Tanpa ini deduplikasi bocor dan daftar penekanan bisa dilewati hanya dengan
mengubah huruf besar-kecil.

### 002_contacts.sql

```sql
CREATE TYPE consent_source AS ENUM (
  'pelanggan_existing', 'formulir_web', 'izin_lisan',
  'pameran', 'referral', 'alamat_generik_terpublikasi', 'lainnya'
);
CREATE TYPE consent_strength AS ENUM ('kuat', 'cukup', 'perlu_ditinjau');
CREATE TYPE email_origin    AS ENUM ('found', 'guessed', 'manual');
CREATE TYPE contact_status  AS ENUM ('aktif', 'karantina', 'diblokir');

CREATE TABLE contacts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE,
  domain            text   NOT NULL,
  company_name      text,
  consent_source    consent_source   NOT NULL,
  consent_strength  consent_strength NOT NULL,
  consent_date      date,
  email_origin      email_origin     NOT NULL DEFAULT 'manual',
  status            contact_status   NOT NULL DEFAULT 'karantina',
  reference_contact jsonb  NOT NULL DEFAULT '{}'::jsonb,
  address           text,
  acquisition_note  text,
  import_batch_id   uuid,
  imported_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contacts_status_idx ON contacts (status);
CREATE INDEX contacts_batch_idx  ON contacts (import_batch_id);
CREATE INDEX contacts_domain_idx ON contacts (domain);
```

Dua hal yang disengaja:

`consent_source` **NOT NULL tanpa nilai bawaan**. Kontak tanpa sumber izin
harus gagal di tingkat database, bukan hanya ditolak di form. Aturan yang
hanya hidup di lapisan aplikasi akan terlewat saat ada skrip yang menulis
langsung ke tabel.

`status` bawaannya `karantina`, bukan `aktif`. Kalau ada jalur kode yang lupa
menetapkan status, akibatnya kontak tidak terkirimi — bukan terkirimi tanpa
diverifikasi.

### 003_suppression.sql

```sql
CREATE TYPE suppression_reason AS ENUM (
  'unsubscribe', 'hard_bounce', 'keluhan', 'manual'
);

CREATE TABLE suppression (
  email       citext PRIMARY KEY,
  reason      suppression_reason NOT NULL,
  campaign_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

REVOKE DELETE, TRUNCATE ON suppression FROM PUBLIC;
```

Baris `REVOKE` itu penegakan lapis terakhir. Sesuai
`04-aturan-kepatuhan.md`, daftar ini permanen — dan cara paling andal
memastikannya adalah membuat penghapusan gagal bahkan bila ada kode yang
mencobanya.

Buat juga peran aplikasi yang tidak punya hak `DELETE` pada tabel ini.

### 004_import_batches.sql

```sql
CREATE TABLE import_batches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename       text NOT NULL,
  row_count      integer NOT NULL DEFAULT 0,
  accepted       integer NOT NULL DEFAULT 0,
  rejected       integer NOT NULL DEFAULT 0,
  quarantined    integer NOT NULL DEFAULT 0,
  duplicate      integer NOT NULL DEFAULT 0,
  consent_source consent_source NOT NULL,
  declared_by    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contacts
  ADD CONSTRAINT contacts_batch_fk
  FOREIGN KEY (import_batch_id) REFERENCES import_batches(id)
  ON DELETE SET NULL;
```

`ON DELETE SET NULL`, bukan `CASCADE`. Membatalkan batch menghapus kontaknya
lewat kode yang tahu harus menyisakan alamat yang sudah masuk daftar
penekanan. Penghapusan berantai di tingkat database akan melewati aturan itu.

### 005_job_queue.sql

```sql
CREATE TYPE job_status AS ENUM ('pending', 'running', 'done', 'failed');

CREATE TABLE job_queue (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type     text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       job_status NOT NULL DEFAULT 'pending',
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX job_queue_pickup_idx
  ON job_queue (status, scheduled_at)
  WHERE status = 'pending';
```

Pengambilan pekerjaan memakai `FOR UPDATE SKIP LOCKED` supaya aman kalau nanti
ada lebih dari satu worker.

### Selesai bila

- `npm run migrate` jalan dari nol dan idempoten saat dijalankan ulang
- Menyisipkan `contacts` tanpa `consent_source` ditolak database
- `DELETE FROM suppression` gagal dengan peran aplikasi

---

## Tugas 2 — Penekanan dan berhenti berlangganan

Dikerjakan sebelum impor. Ini satu-satunya bagian yang, kalau ditunda,
kerusakannya tidak terdeteksi saat terjadi.

### Yang dibangun

**Token berhenti berlangganan.** HMAC dari `contact_id` dengan kunci rahasia
aplikasi, bukan angka berurutan atau UUID mentah. Token yang bisa ditebak
memungkinkan orang lain menghentikan langganan kontak yang bukan miliknya.

**`GET /unsubscribe/:token`** — publik, tanpa autentikasi, satu klik langsung
berlaku. Halaman konfirmasi bertingkat atau keharusan masuk akun membuatnya
tidak memenuhi syarat "berfungsi seketika".

Responsnya halaman HTML sederhana, bukan JSON. Ini satu-satunya bagian
sistem yang dilihat penerima, jadi pastikan terbaca di ponsel.

**`GET /suppression`** — daftar berpaginasi, hanya baca. Tidak ada endpoint
hapus, dan itu bukan kelalaian.

**`POST /webhooks/ses`** — boleh ditulis sekarang meski SES belum aktif.
Bentuk payload SNS sudah terdokumentasi, jadi bisa diuji dengan payload
tiruan. Verifikasi tanda tangan SNS wajib ada sejak awal — endpoint publik
yang menerima apa pun bisa dipakai orang lain untuk memasukkan alamat ke
daftar penekanan.

### Selesai bila

- Mengunjungi tautan berhenti berlangganan memasukkan alamat ke `suppression`
  dan mengubah status kontak jadi `diblokir`
- Token yang diubah sedikit pun ditolak
- Payload SNS tiruan dengan `notificationType: Bounce` masuk daftar penekanan
- Payload dengan tanda tangan salah ditolak

---

## Tugas 3 — Impor kontak

### Endpoint

| Metode | Jalur | Fungsi |
|---|---|---|
| `POST` | `/imports` | Unggah, kembalikan `batch_id` + 5 baris pratinjau |
| `POST` | `/imports/:id/mapping` | Simpan pemetaan, jalankan validasi |
| `POST` | `/imports/:id/commit` | Simpan baris yang lolos |
| `DELETE` | `/imports/:id` | Batalkan batch |

Validasi dan commit dipisah supaya pengguna melihat ringkasan sebelum satu
baris pun tersimpan. Membatalkan pada tahap ringkasan tidak boleh menyisakan
apa pun.

### Deteksi Contact Harvester

Cocokkan susunan kolom dengan 13 nama dari `02-model-data.md`. Bila cocok,
lewati langkah pemetaan dan tampilkan hasilnya sebagai konfirmasi saja.

### Aturan validasi

| Kondisi | Hasil |
|---|---|
| Format alamat tidak valid | Ditolak |
| Ada di `suppression` | Ditolak, tidak dapat ditimpa |
| Sudah ada di `contacts` | Duplikat, dilewati |
| `status` kolom sumber bukan `ok` | Ditolak |
| `email_source = guessed` | Diterima, status `karantina` |
| `email_source = found` | Diterima, status `karantina` sampai diverifikasi |
| `consent_source` kosong | Impor dihentikan seluruhnya |

Perhatikan baris terakhir: yang dihentikan seluruh impornya, bukan barisnya.
Berkas tanpa sumber izin berarti pengguna belum menyatakan dasar izinnya, dan
itu bukan kesalahan per baris.

### Dekripsi `.enc`

Format: salt di depan, diikuti muatan Fernet, kunci diturunkan lewat
PBKDF2-HMAC-SHA256 — sama seperti `crypto_utils.py` di Contact Harvester.
Dekripsi di memori, tidak pernah menulis berkas terdekripsi ke disk.

Bedakan dua kegagalan dalam pesan yang berbeda: kata sandi salah, dan berkas
berubah. Keduanya terlihat sama bagi Fernet, tapi artinya berbeda bagi
pengguna.

### Selesai bila

- CSV dan `.enc` sungguhan dari Contact Harvester berhasil diimpor
- Baris `guessed` masuk sebagai `karantina`
- Alamat yang ada di `suppression` ditolak
- Membatalkan batch menghapus kontaknya, menyisakan yang sudah tersuppress
- Berkas tanpa `consent_source` ditolak sebelum menyimpan apa pun

---

## Tugas 4 — Sambungkan layar

`lib/api.ts` sudah ada tapi belum dipakai layar mana pun. Ganti impor `mock`
satu layar per satu:

1. `SuppressionScreen` — paling sederhana, hanya baca
2. `ContactsScreen` — daftar dan filter
3. `ImportScreen` — alur tiga langkah, paling banyak state
4. Sisanya menyusul di Fase 2

Tangani tiga keadaan di setiap layar: memuat, kosong, dan gagal. Keadaan
kosong adalah ajakan bertindak, bukan sekadar tulisan "tidak ada data".

Simpan `lib/mock.ts` sampai seluruh layar tersambung — berguna untuk
membandingkan saat sesuatu terlihat salah.

---

## Yang belum boleh dikerjakan

Meski menggoda karena kerangkanya sudah ada:

- Handler `send-worker` — butuh SES aktif untuk diuji dengan benar
- Perhitungan pemanasan domain — Fase 3
- Layar laporan dari data nyata — belum ada data

Mengerjakannya sekarang berarti menulis kode yang tidak bisa diuji, dan kode
yang tidak diuji pada bagian pengiriman adalah tempat kesalahan paling mahal
bersembunyi.

## Perkiraan

| Tugas | Perkiraan |
|---|---|
| 1 — Migrasi dan skema | 3–4 hari |
| 2 — Penekanan dan berhenti berlangganan | 4–5 hari |
| 3 — Impor kontak | 7–10 hari |
| 4 — Sambungkan layar | 3–4 hari |

Sekitar 3–4 minggu paruh waktu. Persetujuan sandbox SES umumnya turun jauh
lebih cepat dari itu, jadi Fase 2 tidak akan tertahan menunggu.
