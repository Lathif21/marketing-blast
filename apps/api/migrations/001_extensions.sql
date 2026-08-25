-- citext supaya Info@Domain.com dan info@domain.com dihitung satu alamat.
-- Tanpa ini deduplikasi bocor dan daftar penekanan bisa dilewati hanya dengan
-- mengubah huruf besar-kecil.
CREATE EXTENSION IF NOT EXISTS citext;

-- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;
