// Akses tabel `users` dan `sessions`.
//
// Satu-satunya modul yang menyentuh keduanya. Keduanya berada DI LUAR Row
// Level Security (lihat catatan di migrasi 010), jadi penyaringan per
// pelanggan di sini ditulis tangan — dan itulah sebabnya aksesnya dikumpulkan
// di satu berkas alih-alih disebar ke rute yang membutuhkannya.
//
// Setiap fungsi di bawah yang menerima `tenantId` menyaringnya di SQL, bukan
// di pemanggil. Fungsi yang tidak menerimanya memang dimaksudkan lintas
// pelanggan, dan hanya dipakai jalur superadmin.

import { queryGlobal } from "../db.js";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hashSandi, sandiCocok } from "./password.js";

export type Peran = "superadmin" | "admin" | "operator";

export interface Pengguna {
  id: string;
  tenant_id: string | null;
  email: string;
  nama: string;
  peran: Peran;
  aktif: boolean;
  created_at: string;
  last_login_at: string | null;
}

const KOLOM = `id, tenant_id, email::text AS email, nama, peran::text AS peran,
               aktif, created_at, last_login_at`;

/** Umur sesi. Cukup panjang untuk satu hari kerja, cukup pendek untuk dilupakan. */
export const UMUR_SESI_JAM = 12;

/**
 * Token sesi disimpan sebagai hash, bukan apa adanya.
 *
 * Basis data yang bocor karena itu tidak menyerahkan sesi yang masih hidup —
 * yang bocor hanyalah hash, dan hash tidak dapat dipakai masuk. Ini alasan
 * yang sama seperti kata sandi, hanya dengan masa hidup yang lebih pendek.
 *
 * SHA-256 tanpa peregangan sudah cukup di sini, berbeda dengan kata sandi:
 * tokennya 32 byte acak, jadi tidak ada kamus yang dapat dicoba.
 */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface SesiAktif {
  token_hash: string;
  pengguna: Pengguna;
  /** Terisi bila superadmin sedang masuk sebagai pelanggan. */
  impersonasi: string | null;
  impersonasi_nama: string | null;
  impersonasi_slug: string | null;
}

// ── Pengguna ────────────────────────────────────────────────────────────────

export async function cariPenggunaLewatEmail(
  email: string,
): Promise<(Pengguna & { password_hash: string }) | null> {
  const { rows } = await queryGlobal<Pengguna & { password_hash: string }>(
    `SELECT ${KOLOM}, password_hash FROM users WHERE email = $1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function buatPengguna(input: {
  tenantId: string | null;
  email: string;
  nama: string;
  peran: Peran;
  sandi: string;
}): Promise<Pengguna> {
  const hash = await hashSandi(input.sandi);
  const { rows } = await queryGlobal<Pengguna>(
    `INSERT INTO users (tenant_id, email, nama, peran, password_hash)
     VALUES ($1, $2, $3, $4::peran_pengguna, $5)
     RETURNING ${KOLOM}`,
    [input.tenantId, input.email, input.nama, input.peran, hash],
  );
  return rows[0];
}

export async function daftarPengguna(tenantId: string): Promise<Pengguna[]> {
  const { rows } = await queryGlobal<Pengguna>(
    `SELECT ${KOLOM} FROM users WHERE tenant_id = $1 ORDER BY created_at`,
    [tenantId],
  );
  return rows;
}

export async function ubahAktifPengguna(id: string, aktif: boolean): Promise<Pengguna | null> {
  const { rows } = await queryGlobal<Pengguna>(
    // Superadmin tidak dapat dinonaktifkan lewat jalur ini. Satu-satunya
    // pengguna yang dapat mengelola pengguna lain adalah superadmin, jadi
    // menonaktifkan superadmin terakhir akan mengunci seluruh instalasi tanpa
    // jalan masuk — keadaan yang hanya dapat diperbaiki lewat SQL langsung.
    `UPDATE users SET aktif = $2 WHERE id = $1 AND peran <> 'superadmin'
     RETURNING ${KOLOM}`,
    [id, aktif],
  );
  return rows[0] ?? null;
}

export async function setelSandi(id: string, sandi: string): Promise<boolean> {
  const hash = await hashSandi(sandi);
  const { rowCount } = await queryGlobal(
    "UPDATE users SET password_hash = $2 WHERE id = $1",
    [id, hash],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Memverifikasi kredensial.
 *
 * Kata sandi tetap di-hash walaupun emailnya tidak ditemukan. Tanpa itu,
 * balasan untuk email yang tidak terdaftar datang jauh lebih cepat daripada
 * yang terdaftar, dan selisih itu cukup untuk memetakan siapa saja yang punya
 * akun di instalasi ini.
 */
export async function verifikasiKredensial(
  email: string,
  sandi: string,
): Promise<Pengguna | null> {
  const pengguna = await cariPenggunaLewatEmail(email);
  const hashPembanding =
    pengguna?.password_hash ??
    "scrypt$32768$8$1$00000000000000000000000000000000$" + "0".repeat(128);

  const cocok = await sandiCocok(sandi, hashPembanding);
  if (!pengguna || !cocok || !pengguna.aktif) return null;

  const { password_hash: _buang, ...bersih } = pengguna;
  return bersih;
}

// ── Sesi ─────────────────────────────────────────────────────────────────────

/** Mengembalikan token mentah — satu-satunya saat nilainya pernah terlihat. */
export async function buatSesi(userId: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const { rows } = await queryGlobal<{ expires_at: string }>(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(hours => $3))
     RETURNING expires_at`,
    [hashToken(token), userId, UMUR_SESI_JAM],
  );

  await queryGlobal("UPDATE users SET last_login_at = now() WHERE id = $1", [userId]);
  return { token, expiresAt: rows[0].expires_at };
}

/**
 * Membaca sesi beserta penggunanya, sekaligus menyegarkan `last_seen_at`.
 *
 * Sesi kedaluwarsa disaring di SQL, bukan dibandingkan di JavaScript: jam
 * proses aplikasi dan jam basis data dapat berbeda, dan yang menentukan harus
 * satu — jam yang sama yang menuliskan `expires_at`.
 *
 * Pengguna yang sudah dinonaktifkan ikut tersaring di sini. Tanpa itu,
 * menonaktifkan akun hanya mencegah login berikutnya sementara sesi yang
 * sedang berjalan tetap hidup sampai kedaluwarsa — dan pencabutan seketika
 * adalah inti dari pembekuan.
 */
export async function bacaSesi(token: string): Promise<SesiAktif | null> {
  const { rows } = await queryGlobal<
    Pengguna & {
      token_hash: string;
      impersonasi: string | null;
      impersonasi_nama: string | null;
      impersonasi_slug: string | null;
    }
  >(
    `WITH hidup AS (
       UPDATE sessions
          SET last_seen_at = now()
        WHERE token_hash = $1 AND expires_at > now()
       RETURNING token_hash, user_id, impersonasi
     )
     SELECT h.token_hash,
            h.impersonasi,
            t.nama       AS impersonasi_nama,
            t.slug::text AS impersonasi_slug,
            u.id, u.tenant_id, u.email::text AS email, u.nama,
            u.peran::text AS peran, u.aktif, u.created_at, u.last_login_at
       FROM hidup h
       JOIN users u ON u.id = h.user_id
       LEFT JOIN tenants t ON t.id = h.impersonasi`,
    [hashToken(token)],
  );

  const baris = rows[0];
  if (!baris || !baris.aktif) return null;

  return {
    token_hash: baris.token_hash,
    impersonasi: baris.impersonasi,
    impersonasi_nama: baris.impersonasi_nama,
    impersonasi_slug: baris.impersonasi_slug,
    pengguna: {
      id: baris.id,
      tenant_id: baris.tenant_id,
      email: baris.email,
      nama: baris.nama,
      peran: baris.peran,
      aktif: baris.aktif,
      created_at: baris.created_at,
      last_login_at: baris.last_login_at,
    },
  };
}

export async function hapusSesi(token: string): Promise<void> {
  await queryGlobal("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}

/**
 * Mencabut seluruh sesi milik satu pelanggan.
 *
 * Dipanggil saat pelanggan dibekukan atau dinonaktifkan. Tanpa ini,
 * pembekuan hanya menghentikan pengiriman sementara pengguna yang sedang
 * masuk tetap dapat bekerja sampai sesinya habis sendiri.
 */
export async function cabutSesiTenant(tenantId: string): Promise<number> {
  const { rowCount } = await queryGlobal(
    `DELETE FROM sessions
      WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)`,
    [tenantId],
  );
  return rowCount ?? 0;
}

/** Menyetel atau melepas impersonasi pada sesi yang sedang berjalan. */
export async function setelImpersonasi(
  token: string,
  tenantId: string | null,
): Promise<void> {
  await queryGlobal("UPDATE sessions SET impersonasi = $2 WHERE token_hash = $1", [
    hashToken(token),
    tenantId,
  ]);
}

/** Membuang sesi kedaluwarsa. Dipanggil pekerjaan terjadwal. */
export async function sapuSesiKedaluwarsa(): Promise<number> {
  const { rowCount } = await queryGlobal("DELETE FROM sessions WHERE expires_at < now()");
  return rowCount ?? 0;
}

/**
 * Perbandingan tetap-waktu untuk dua string pendek. Dipakai membandingkan
 * token yang datang dari luar dengan nilai yang kita kenal.
 */
export function samaAman(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
