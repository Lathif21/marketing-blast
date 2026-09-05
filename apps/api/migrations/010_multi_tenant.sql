-- Multi-tenant: satu instalasi melayani banyak pelanggan.
--
-- Keputusannya tercatat di 02-model-data.md. Yang perlu dipahami sebelum
-- menyentuh berkas ini: kebocoran antar-pelanggan di produk ini bukan sekadar
-- kesalahan privasi. Kontak pelanggan A yang ikut terkirimi kampanye pelanggan
-- B menghasilkan keluhan spam pada domain pelanggan B — dan keluhan itulah
-- yang merusak reputasi, hal yang justru dijaga seluruh produk ini.
--
-- Karena itu penyaringan per pelanggan TIDAK diserahkan ke lapisan aplikasi.
-- Aturan yang hanya hidup di query akan terlewat: satu `WHERE tenant_id` yang
-- lupa ditulis tidak menghasilkan galat apa pun, hanya kampanye yang terkirim
-- ke orang yang salah. Yang menegakkannya di sini adalah Row Level Security
-- pada peran aplikasi, dengan `tenant_id` yang terisi sendiri lewat DEFAULT.
--
-- Akibatnya, query di aplikasi tidak perlu menyebut `tenant_id` sama sekali —
-- bukan karena boleh lupa, melainkan karena database yang menambahkannya.

-- ── Pelanggan ────────────────────────────────────────────────────────────────

CREATE TYPE status_tenant AS ENUM (
  'aktif',
  -- Dibekukan: data tetap terlihat pemiliknya, pengiriman berhenti. Dipakai
  -- saat reputasi memburuk atau tagihan tertunggak. Membekukan berbeda dari
  -- menonaktifkan justru karena pelanggan masih perlu melihat sebabnya.
  'dibekukan',
  'nonaktif'
);

CREATE TABLE tenants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nama           text NOT NULL,
  -- Pengenal pendek yang muncul di URL dan log. Huruf kecil, tanpa spasi.
  slug           citext NOT NULL UNIQUE
                 CONSTRAINT slug_bentuk CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  status         status_tenant NOT NULL DEFAULT 'aktif',
  -- Batas jumlah kontak. `null` berarti tanpa batas.
  kuota_kontak   integer CONSTRAINT kuota_kontak_wajar CHECK (kuota_kontak IS NULL OR kuota_kontak > 0),
  catatan        text,
  -- Alasan pembekuan disimpan, bukan hanya tanggalnya. Pelanggan yang
  -- pengirimannya berhenti akan bertanya kenapa, dan jawabannya harus ada di
  -- sistem — bukan di ingatan orang yang membekukan.
  alasan_beku    text,
  dibekukan_pada timestamptz,
  dibekukan_oleh text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenants_status_idx ON tenants (status);

-- Pelanggan bawaan untuk seluruh data yang sudah ada.
--
-- Kolom `tenant_id` di bawah dibuat NOT NULL, jadi baris yang sudah ada harus
-- punya pemilik. Membiarkannya NULL "sementara" berarti RLS tidak pernah
-- benar-benar mengikat pada data lama — dan data lama itulah yang paling lama
-- ada di sistem.
INSERT INTO tenants (nama, slug, catatan)
VALUES ('Pelanggan Bawaan', 'bawaan',
        'Dibuat migrasi 010 sebagai pemilik seluruh data sebelum multi-tenant.');

-- ── Konteks permintaan ───────────────────────────────────────────────────────
--
-- Dua fungsi ini yang dibaca setiap policy. Keduanya membaca variabel sesi
-- yang disetel `dalamKonteks()` di apps/api/src/db.ts.
--
-- `current_setting(..., true)` — argumen kedua `true` berarti "kembalikan NULL
-- kalau belum disetel" alih-alih melempar. Itu disengaja: koneksi yang belum
-- punya konteks harus melihat NOL BARIS, bukan gagal dengan galat yang lalu
-- ditangani sebagai "coba lagi tanpa filter".

CREATE FUNCTION app_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
  $$;

CREATE FUNCTION app_superadmin() RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT coalesce(current_setting('app.superadmin', true), '') = 'on'
  $$;

COMMENT ON FUNCTION app_tenant() IS
  'Pelanggan yang sedang dilayani koneksi ini. NULL berarti tanpa konteks, dan tanpa konteks berarti tidak ada baris yang terlihat.';

-- ── Penempelan tenant_id ─────────────────────────────────────────────────────
--
-- Pola yang sama untuk setiap tabel data pelanggan:
--
--   1. kolom ditambahkan tanpa NOT NULL supaya baris lama bisa diisi
--   2. baris lama diberikan ke pelanggan bawaan
--   3. NOT NULL dipasang, dan DEFAULT app_tenant() dipasang
--   4. RLS dinyalakan beserta policy-nya
--
-- Langkah 3 adalah yang membuat INSERT di aplikasi tidak perlu berubah:
-- kolomnya terisi dari konteks koneksi. Langkah 4 yang membuat SELECT,
-- UPDATE, dan DELETE tidak perlu berubah.

DO $$
DECLARE
  t text;
  bawaan uuid;
BEGIN
  SELECT id INTO bawaan FROM tenants WHERE slug = 'bawaan';

  FOREACH t IN ARRAY ARRAY[
    'contacts', 'campaigns', 'campaign_recipients', 'suppression',
    'import_batches', 'domain_health', 'domain_daily_sends'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE', t);
    EXECUTE format('UPDATE %I SET tenant_id = $1', t) USING bawaan;
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL,
                      ALTER COLUMN tenant_id SET DEFAULT app_tenant()', t);
    EXECUTE format('CREATE INDEX %I ON %I (tenant_id)', t || '_tenant_idx', t);

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- Satu policy untuk semua perintah. Superadmin melewatinya hanya bila
    -- `app.superadmin` benar-benar disetel 'on', dan itu hanya terjadi untuk
    -- sesi yang perannya memang superadmin (lihat auth/context.ts).
    EXECUTE format($p$
      CREATE POLICY isolasi_tenant ON %I
        USING (tenant_id = app_tenant() OR app_superadmin())
        WITH CHECK (tenant_id = app_tenant() OR app_superadmin())
    $p$, t);
  END LOOP;
END $$;

-- ── Keunikan yang harus ikut menjadi per pelanggan ───────────────────────────
--
-- `contacts.email` semula unik secara global. Dibiarkan begitu, pelanggan
-- kedua yang mengimpor alamat yang sudah dipakai pelanggan pertama akan
-- ditolak dengan galat duplikat — padahal kedua perusahaan itu memang bisa
-- sama-sama berhubungan dengan satu alamat yang sama, dan tidak boleh saling
-- mengetahui hal itu. Pesan galat duplikat sendiri sudah membocorkan bahwa
-- alamat itu ada di sistem.
ALTER TABLE contacts DROP CONSTRAINT contacts_email_key;
ALTER TABLE contacts ADD CONSTRAINT contacts_tenant_email_key UNIQUE (tenant_id, email);

-- Daftar penekanan menjadi per pelanggan.
--
-- Alternatifnya — satu daftar global — melindungi reputasi lebih kuat, tapi
-- berarti penolakan yang diterima pelanggan A membatasi jangkauan pelanggan B
-- tanpa pernah disepakati siapa pun. Itu keputusan kontrak, bukan keputusan
-- skema, dan skema tidak boleh memutuskannya diam-diam.
--
-- Sifat permanennya tidak berubah: peran aplikasi tetap tidak punya DELETE.
ALTER TABLE suppression DROP CONSTRAINT suppression_pkey;
ALTER TABLE suppression ADD CONSTRAINT suppression_pkey PRIMARY KEY (tenant_id, email);

-- Domain pengirim TIDAK menjadi per pelanggan, dan ini bukan kelalaian.
--
-- Reputasi menempel pada domain, bukan pada baris di tabel kita. Dua pelanggan
-- yang mengirim dari domain yang sama akan berbagi reputasi sekaligus
-- melipatgandakan volume harian di belakang batas pemanasan masing-masing —
-- persis kerusakan yang jadwal pemanasan dirancang untuk mencegah.
--
-- Kunci primer `domain` yang tetap global membuat keadaan itu tidak dapat
-- terjadi: domain hanya bisa dimiliki satu pelanggan, dan pelanggan kedua yang
-- mencoba memakainya ditolak database.
COMMENT ON COLUMN domain_health.tenant_id IS
  'Pemilik domain. Kunci primernya tetap `domain` secara global: satu domain hanya boleh dipakai satu pelanggan, supaya batas pemanasan tidak dapat dilipatgandakan.';

-- ── Pengguna, sesi, dan jejak audit ──────────────────────────────────────────
--
-- Tiga tabel ini SENGAJA tidak memakai RLS.
--
-- Bukan karena kurang penting, melainkan karena merekalah yang menetapkan
-- konteks pelanggan. Policy `tenant_id = app_tenant()` pada tabel `users`
-- menghasilkan lingkaran: konteks belum ada saat seseorang login, sehingga
-- barisnya sendiri tidak terlihat, sehingga login tidak pernah bisa berhasil.
--
-- Penyaringannya karena itu berada di `auth/`, dan hanya di sana. Tidak ada
-- rute lain yang boleh menyentuh ketiga tabel ini.

CREATE TYPE peran_pengguna AS ENUM (
  -- Pengendali seluruh instalasi. `tenant_id` NULL — ia bukan milik pelanggan
  -- mana pun, dan itulah yang membedakannya.
  'superadmin',
  'admin',     -- pemilik akun pelanggan
  'operator'   -- menyusun dan mengirim kampanye, tidak mengelola pengguna
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL hanya untuk superadmin. CHECK di bawah yang menegakkannya, supaya
  -- tidak mungkin ada admin pelanggan tanpa pelanggan — atau superadmin yang
  -- diam-diam terikat pada satu pelanggan.
  tenant_id     uuid REFERENCES tenants(id) ON DELETE CASCADE,
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  nama          text NOT NULL,
  peran         peran_pengguna NOT NULL,
  aktif         boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,

  CONSTRAINT superadmin_tanpa_tenant
    CHECK ((peran = 'superadmin') = (tenant_id IS NULL))
);

CREATE INDEX users_tenant_idx ON users (tenant_id);

-- Sesi disimpan di tabel, bukan hanya sebagai token bertanda tangan.
--
-- Token bertanda tangan tidak dapat dicabut sebelum kedaluwarsa, dan
-- pencabutan seketika adalah inti dari fitur pembekuan: pelanggan yang
-- dibekukan karena reputasinya rusak tidak boleh tetap bisa bekerja sampai
-- tokennya habis sendiri.
--
-- Yang tersimpan adalah HASH token, bukan tokennya. Basis data yang bocor
-- karena itu tidak menyerahkan sesi yang masih hidup.
CREATE TABLE sessions (
  token_hash    text PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Terisi saat superadmin masuk sebagai pelanggan. Sesi yang sama tetap
  -- milik superadmin — yang berubah hanya pelanggan yang dilayaninya.
  impersonasi   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

-- Jejak tindakan superadmin.
--
-- Kewenangan yang dipilih mencakup melihat data pelanggan dan masuk sebagai
-- pelanggan. Keduanya sah untuk dukungan, dan keduanya tidak dapat dibedakan
-- dari penyalahgunaan tanpa catatan. Yang membuat akses semacam itu dapat
-- dipertanggungjawabkan bukan pembatasannya, melainkan jejaknya.
--
-- Tabel ini hanya menerima INSERT dari aplikasi: hak UPDATE dan DELETE dicabut
-- di src/migrate.ts, sama seperti daftar penekanan. Jejak yang dapat disunting
-- oleh yang dijejaki bukan jejak.
CREATE TABLE admin_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Disalin, bukan hanya direferensikan: pengguna bisa dihapus, catatan
  -- tindakannya tidak boleh ikut kehilangan pelakunya.
  actor_id    uuid,
  actor_email citext NOT NULL,
  tenant_id   uuid,
  tenant_slug citext,
  aksi        text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_audit_waktu_idx ON admin_audit (created_at DESC);
CREATE INDEX admin_audit_tenant_idx ON admin_audit (tenant_id, created_at DESC);

-- ── Jalur publik: menemukan pemilik tanpa konteks ────────────────────────────
--
-- Dua rute berjalan di luar autentikasi apa pun, dan memang harus begitu:
--
--   /unsubscribe/:token — penerima tidak punya akun, dan tidak boleh diminta
--   /webhooks/ses       — SNS tidak dapat membawa kredensial kita
--
-- Keduanya karena itu tiba tanpa konteks pelanggan, dan tanpa konteks RLS
-- menyembunyikan seluruh baris. Dibiarkan begitu, akibatnya bukan galat yang
-- terlihat melainkan dua kerusakan paling mahal yang bisa dialami sistem ini:
-- tautan berhenti berlangganan yang menjawab "tautan tidak berlaku" kepada
-- orang yang ingin keluar, dan pemantulan keras yang tidak pernah masuk daftar
-- penekanan.
--
-- Jalan keluarnya bukan mengendurkan policy — itu akan membuka seluruh data ke
-- koneksi tanpa konteks. Yang dipakai adalah tiga fungsi SECURITY DEFINER yang
-- HANYA mengembalikan pemiliknya. Fungsi berjalan sebagai pemilik skema
-- sehingga melewati RLS, tapi yang dapat dikembalikannya cuma satu uuid;
-- aplikasi lalu memasang konteks itu dan bekerja di dalamnya seperti biasa.
--
-- `SET search_path` dipasang eksplisit pada setiap fungsi. Tanpa itu, fungsi
-- SECURITY DEFINER dapat dibelokkan lewat skema yang disisipkan pemanggil —
-- kelemahan klasik yang justru berbahaya karena fungsinya berjalan dengan hak
-- pemilik.

CREATE FUNCTION tenant_dari_unsubscribe(pengenal uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT tenant_id FROM contacts WHERE id = pengenal
    UNION ALL
    SELECT tenant_id FROM campaign_recipients WHERE id = pengenal
    LIMIT 1
  $$;

COMMENT ON FUNCTION tenant_dari_unsubscribe(uuid) IS
  'Pemilik di balik satu token berhenti berlangganan. Dicari di contacts dan campaign_recipients — id baris penerima bertahan meski kontaknya dihapus.';

CREATE FUNCTION tenant_dari_message(msg text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT tenant_id FROM campaign_recipients
     WHERE message_id = msg OR message_id = split_part(msg, '@', 1)
     LIMIT 1
  $$;

-- Balasan masuk kadang tidak membawa header In-Reply-To. Yang tersisa hanyalah
-- alamat pengirimnya, dan alamat yang sama bisa menjadi kontak beberapa
-- pelanggan sekaligus. Yang dipilih adalah pengiriman TERAKHIR ke alamat itu —
-- tebakan terbaik yang tersedia, dan tebakan yang salah di sini hanya berarti
-- balasan tercatat pada pelanggan yang keliru, bukan pesan terkirim ke orang
-- yang keliru.
CREATE FUNCTION tenant_dari_email_terkirim(alamat citext) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT tenant_id FROM campaign_recipients
     WHERE email = alamat AND sent_at IS NOT NULL
     ORDER BY sent_at DESC
     LIMIT 1
  $$;
