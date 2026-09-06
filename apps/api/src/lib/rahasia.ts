// Enkripsi rahasia yang harus dapat dibaca kembali.
//
// Berbeda dari kata sandi di `auth/password.ts`, yang justru TIDAK boleh dapat
// dibaca kembali. Di sini yang disimpan adalah token penyegar Google: sistem
// harus dapat memakainya lagi nanti, jadi hash searah tidak berlaku.
//
// AES-256-GCM, bukan AES-CBC. GCM memberi autentikasi sekaligus kerahasiaan:
// ciphertext yang diubah satu bit pun gagal saat dibuka, alih-alih membuka
// menjadi sampah yang lalu dikirim ke Google sebagai token. Bedanya penting di
// sini — yang dikirim ke pihak luar harus dipastikan persis yang dulu ditulis.
//
// Kuncinya diturunkan dari `TOKEN_SECRET` lewat scrypt, bukan dipakai apa
// adanya. Rahasia dari variabel lingkungan panjangnya sembarang dan entropinya
// tidak merata; kunci AES menuntut 32 byte yang tersebar rata.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { config } from "../config.js";

const ALGO = "aes-256-gcm";
const PANJANG_IV = 12; // 96 bit, ukuran yang dianjurkan untuk GCM
const PANJANG_TAG = 16;

/**
 * Salt tetap, bukan acak per enkripsi.
 *
 * Salt acak menuntut penyimpanan salt itu bersama setiap ciphertext dan
 * penurunan kunci scrypt pada SETIAP operasi — mahal, dan tidak membeli apa
 * pun di sini: yang dilindungi salt adalah serangan kamus terhadap kata sandi
 * manusia, sementara `TOKEN_SECRET` adalah rahasia acak panjang yang tidak ada
 * di kamus mana pun. IV yang acak per pesan tetap ada, dan itulah yang
 * memastikan dua ciphertext tidak pernah sama.
 */
const SALT = Buffer.from("marketing-blast/token-v1");

let kunciTersimpan: Buffer | null = null;

function kunci(): Buffer {
  if (kunciTersimpan) return kunciTersimpan;

  const rahasia = config.tokenSecret;
  if (!rahasia) {
    throw new Error(
      "TOKEN_SECRET kosong. Tanpa itu token penyegar Gmail tidak dapat " +
        "disimpan terenkripsi, dan menyimpannya apa adanya berarti satu " +
        "kebocoran basis data menyerahkan akses ke kotak masuk pelanggan.",
    );
  }

  kunciTersimpan = scryptSync(rahasia, SALT, 32);
  return kunciTersimpan;
}

/** Bentuk tersimpan: `v1.<iv base64url>.<tag base64url>.<ciphertext base64url>`. */
export function enkripsi(teks: string): string {
  const iv = randomBytes(PANJANG_IV);
  const cipher = createCipheriv(ALGO, kunci(), iv);
  const isi = Buffer.concat([cipher.update(teks, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    isi.toString("base64url"),
  ].join(".");
}

/**
 * Mengembalikan `null` bila tidak dapat dibuka — bentuk salah, kunci berganti,
 * atau isinya diubah.
 *
 * Sengaja tidak melempar. Pemanggilnya adalah pekerjaan latar yang menyapu
 * banyak pelanggan; satu koneksi yang tidak dapat dibuka harus menjadi satu
 * koneksi yang ditandai perlu disambung ulang, bukan lemparan yang
 * menghentikan sinkronisasi pelanggan lain.
 */
export function dekripsi(tersimpan: string): string | null {
  const bagian = tersimpan.split(".");
  if (bagian.length !== 4 || bagian[0] !== "v1") return null;

  try {
    const iv = Buffer.from(bagian[1], "base64url");
    const tag = Buffer.from(bagian[2], "base64url");
    const isi = Buffer.from(bagian[3], "base64url");
    if (iv.length !== PANJANG_IV || tag.length !== PANJANG_TAG) return null;

    const decipher = createDecipheriv(ALGO, kunci(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(isi), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Dipakai `validateConfig` supaya salah setel ketahuan saat start, bukan saat sinkron. */
export function rahasiaSiap(): boolean {
  return Boolean(config.tokenSecret) && config.tokenSecret.length >= 32;
}
