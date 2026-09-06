-- Koneksi Gmail per pelanggan.
--
-- Dua kegunaan dari satu koneksi:
--
--   1. Deteksi balasan. Balasan kampanye hampir selalu mendarat di kotak masuk
--      biasa tim pemasaran, bukan di alamat yang terpasang receipt rule SES.
--      Itu sebabnya `POST /campaigns/:id/balasan` manual ada sejak awal — dan
--      itu jalur yang paling sering luput dipakai, sehingga sinyal
--      ketertarikan paling kuat justru yang paling sering tidak tercatat.
--
--   2. Impor kontak dari korespondensi dua arah. Alamat yang pernah berbalas
--      dengan tim adalah dasar izin terkuat yang bisa dimiliki sistem ini —
--      jauh di atas alamat hasil pengumpulan otomatis, dan dapat
--      dipertanggungjawabkan bila ditanya.
--
-- Yang TIDAK disimpan, dan tidak boleh ditambahkan: isi pesan. Sistem ini
-- membaca kotak masuk untuk menemukan ALAMAT dan FAKTA bahwa percakapan
-- terjadi, bukan untuk menyimpan korespondensi. Menyimpan isi pesan mengubah
-- produk pemasaran menjadi arsip surat pihak ketiga yang tidak pernah diminta
-- siapa pun untuk dibuat — dan menjadikan satu kebocoran basis data jauh lebih
-- berat akibatnya daripada bocornya daftar kontak.

CREATE TYPE status_gmail AS ENUM (
  'aktif',
  -- Token penyegar tidak lagi diterima Google. Paling sering terjadi karena
  -- aplikasi masih berstatus "Testing" di Google Cloud: di sana token
  -- kedaluwarsa setelah 7 hari, dan satu-satunya jalan keluarnya adalah
  -- pengguna menyambungkan ulang. Dibedakan dari 'dicabut' supaya pesan yang
  -- ditampilkan benar: "sambungkan ulang", bukan "Anda memutuskan koneksi".
  'perlu_sambung_ulang',
  -- Diputus dari sisi kita atau izinnya dicabut pengguna di akun Google-nya.
  'dicabut'
);

CREATE TABLE gmail_connections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_tenant() REFERENCES tenants(id) ON DELETE CASCADE,

  /** Alamat kotak masuk yang tersambung. */
  email          citext NOT NULL,
  /** Pengenal akun Google yang stabil, tidak berubah meski alamatnya berganti. */
  google_sub     text NOT NULL,

  -- Token penyegar TERENKRIPSI (AES-256-GCM, lihat lib/rahasia.ts).
  --
  -- Disimpan terenkripsi, bukan apa adanya, karena isinya bukan sekadar
  -- kredensial layanan kita: ia membuka kotak masuk seseorang. Basis data yang
  -- bocor tanpa kunci enkripsinya karena itu tidak menyerahkan akses ke satu
  -- kotak masuk pun.
  --
  -- NULL berarti koneksinya sudah tidak dapat dipakai lagi — dicabut atau
  -- kedaluwarsa. Barisnya sengaja tetap ada: siapa yang pernah menyambungkan
  -- apa, dan kapan, adalah jejak yang tetap perlu ada setelah koneksinya
  -- berakhir.
  refresh_token  text,
  scopes         text NOT NULL,

  status         status_gmail NOT NULL DEFAULT 'aktif',

  terhubung_oleh text NOT NULL,
  terhubung_pada timestamptz NOT NULL DEFAULT now(),

  /**
   * Batas waktu sinkronisasi terakhir. Putaran berikutnya hanya membaca pesan
   * yang lebih baru dari ini.
   *
   * Bukan optimasi belaka: tanpa batas, setiap putaran membaca ulang seluruh
   * kotak masuk — dan kuota Gmail API dihitung per unit permintaan, bukan per
   * pesan baru. Kotak masuk besar akan menghabiskan kuota harian dalam
   * beberapa putaran, lalu berhenti bekerja tanpa galat yang jelas.
   */
  sinkron_sampai timestamptz,
  last_sync_at   timestamptz,
  last_error     text,

  /** Angka ringkas untuk ditampilkan tanpa menghitung ulang. */
  balasan_tercatat  integer NOT NULL DEFAULT 0,
  kontak_ditambahkan integer NOT NULL DEFAULT 0,

  -- Satu alamat kotak masuk hanya sekali per pelanggan. Tim boleh
  -- menyambungkan beberapa kotak masuk berbeda — kotak masuk bersama dan kotak
  -- masuk penjualan, misalnya — tapi bukan yang sama dua kali.
  UNIQUE (tenant_id, email)
);

CREATE INDEX gmail_connections_tenant_idx ON gmail_connections (tenant_id);
CREATE INDEX gmail_connections_aktif_idx ON gmail_connections (tenant_id)
  WHERE status = 'aktif';

ALTER TABLE gmail_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY isolasi_tenant ON gmail_connections
  USING (tenant_id = app_tenant() OR app_superadmin())
  WITH CHECK (tenant_id = app_tenant() OR app_superadmin());

-- ── Sumber izin baru ─────────────────────────────────────────────────────────
--
-- Korespondensi dua arah: alamat ini pernah membalas tim, atau tim pernah
-- membalasnya. Kekuatannya `kuat` di `consentStrengthOf` — setara pelanggan
-- yang sudah ada, dan lebih kuat daripada alamat generik terpublikasi, karena
-- yang menjadi dasarnya adalah percakapan yang benar-benar terjadi.
--
-- Catatan bagi yang menambah nilai enum lain di kemudian hari: PostgreSQL
-- melarang MEMAKAI nilai enum baru pada transaksi yang sama dengan yang
-- menambahkannya. Migrasi ini hanya menambah, tidak memakai — pemakaiannya
-- terjadi saat aplikasi berjalan, jauh setelah transaksi ini selesai.
ALTER TYPE consent_source ADD VALUE IF NOT EXISTS 'korespondensi_dua_arah';
