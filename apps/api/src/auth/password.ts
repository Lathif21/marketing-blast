// Penyimpanan kata sandi.
//
// scrypt dari `node:crypto`, bukan bcrypt atau argon2 dari npm. Alasannya
// bukan penghematan dependensi: scrypt sudah ada di runtime, sudah diaudit
// sebagai bagian dari Node, dan tidak menambah paket native yang harus
// dikompilasi ulang setiap kali versi Node berganti. Parameternya di bawah
// mengikuti anjuran OWASP untuk scrypt.
//
// Yang TIDAK ada di sini dan sengaja tidak ada: fungsi untuk membaca kembali
// kata sandi. Hash-nya searah, dan satu-satunya operasi yang tersedia adalah
// membandingkan.

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// N=2^15 pada r=8 memakai sekitar 32 MB per pemanggilan. `maxmem` harus
// dinaikkan eksplisit: bawaan Node 32 MB tepat di batas dan menolak dengan
// galat yang menyesatkan ("Invalid scrypt params") alih-alih kehabisan memori.
const PARAM = { N: 2 ** 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };
const PANJANG_KUNCI = 64;

/** Panjang minimum. Pendek, tapi ditegakkan — bukan disarankan di UI saja. */
export const MIN_PANJANG_SANDI = 12;

export function sandiCukupPanjang(sandi: string): boolean {
  return sandi.length >= MIN_PANJANG_SANDI;
}

/**
 * Bentuk tersimpan: `scrypt$<N>$<r>$<p>$<salt hex>$<hash hex>`.
 *
 * Parameternya ikut disimpan, tidak hanya hash-nya. Tanpa itu, menaikkan biaya
 * scrypt di kemudian hari akan membuat seluruh kata sandi lama tidak dapat
 * diverifikasi — dan satu-satunya jalan keluarnya adalah memaksa semua orang
 * menyetel ulang sandinya.
 */
export async function hashSandi(sandi: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(sandi, salt, PANJANG_KUNCI, PARAM);
  return `scrypt$${PARAM.N}$${PARAM.r}$${PARAM.p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/**
 * Membandingkan dengan `timingSafeEqual`, bukan `===`.
 *
 * Perbandingan biasa berhenti di byte pertama yang berbeda, dan selisih waktu
 * itu cukup untuk menebak hash byte demi byte pada koneksi yang stabil.
 */
export async function sandiCocok(sandi: string, tersimpan: string): Promise<boolean> {
  const bagian = tersimpan.split("$");
  if (bagian.length !== 6 || bagian[0] !== "scrypt") return false;

  const [, n, r, p, saltHex, hashHex] = bagian;
  const param = { N: Number(n), r: Number(r), p: Number(p), maxmem: PARAM.maxmem };
  if (!Number.isInteger(param.N) || !Number.isInteger(param.r) || !Number.isInteger(param.p)) {
    return false;
  }

  let salt: Buffer;
  let harapan: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    harapan = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || harapan.length === 0) return false;

  let hasil: Buffer;
  try {
    hasil = await scryptAsync(sandi, salt, harapan.length, param);
  } catch {
    // Parameter tersimpan di luar batas yang diterima runtime ini. Ditolak
    // sebagai "tidak cocok", bukan dilempar: satu baris rusak tidak boleh
    // menjatuhkan endpoint login untuk semua orang.
    return false;
  }

  return hasil.length === harapan.length && timingSafeEqual(hasil, harapan);
}
