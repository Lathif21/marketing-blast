CREATE TYPE suppression_reason AS ENUM (
  'unsubscribe', 'hard_bounce', 'keluhan', 'manual'
);

CREATE TABLE suppression (
  email       citext PRIMARY KEY,
  reason      suppression_reason NOT NULL,
  campaign_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Penegakan lapis terakhir. Daftar ini permanen (04-aturan-kepatuhan.md #2),
-- dan cara paling andal memastikannya adalah membuat penghapusan gagal bahkan
-- bila ada kode yang mencobanya.
--
-- Peran aplikasi dibuat terpisah di src/migrate.ts: ia mendapat SELECT dan
-- INSERT pada tabel ini, tidak pernah DELETE.
REVOKE DELETE, TRUNCATE ON suppression FROM PUBLIC;
