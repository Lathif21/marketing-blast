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
  -- NOT NULL tanpa nilai bawaan: kontak tanpa sumber izin harus gagal di
  -- tingkat database, bukan hanya ditolak di form. Aturan yang hanya hidup di
  -- lapisan aplikasi akan terlewat saat ada skrip yang menulis langsung.
  consent_source    consent_source   NOT NULL,
  consent_strength  consent_strength NOT NULL,
  consent_date      date,
  email_origin      email_origin     NOT NULL DEFAULT 'manual',
  -- Bawaannya karantina, bukan aktif. Kalau ada jalur kode yang lupa
  -- menetapkan status, akibatnya kontak tidak terkirimi -- bukan terkirimi
  -- tanpa diverifikasi.
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
