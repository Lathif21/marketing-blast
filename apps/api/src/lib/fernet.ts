// Dekripsi berkas .enc dari Contact Harvester.
//
// Format: salt di depan, diikuti muatan Fernet. Kunci diturunkan lewat
// PBKDF2-HMAC-SHA256 dari kata sandi dan salt tersebut.
//
// Struktur token Fernet (spec resmi):
//   0        versi, selalu 0x80
//   1..8     timestamp, big-endian 64-bit
//   9..24    IV, 16 byte
//   25..n-32 ciphertext AES-128-CBC dengan padding PKCS7
//   n-32..n  HMAC-SHA256 atas seluruh byte sebelumnya
//
// Kunci Fernet 32 byte terbagi dua: 16 byte pertama untuk HMAC, 16 byte
// berikutnya untuk AES.
//
// Dekripsi seluruhnya di memori. Berkas terdekripsi tidak pernah ditulis ke
// disk — daftar kontak yang sudah didekripsi di disk adalah persis hal yang
// membuat berkasnya dienkripsi sejak awal.

import { createDecipheriv, createHmac, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

export type DecryptFailure =
  | "kata_sandi_salah"
  | "berkas_rusak"
  | "bukan_format_ini";

export class DecryptError extends Error {
  constructor(
    public kind: DecryptFailure,
    message: string,
  ) {
    super(message);
    this.name = "DecryptError";
  }
}

const PESAN: Record<DecryptFailure, string> = {
  kata_sandi_salah:
    "Kata sandi salah. Periksa kembali sandi yang dipakai saat berkas ini diekspor.",
  berkas_rusak:
    "Berkas berubah atau rusak sejak dienkripsi. Ekspor ulang dari Contact Harvester.",
  bukan_format_ini:
    "Berkas ini bukan keluaran terenkripsi Contact Harvester, atau terpotong saat disalin.",
};

function fail(kind: DecryptFailure): never {
  throw new DecryptError(kind, PESAN[kind]);
}

export function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, config.enc.pbkdf2Iterations, 32, "sha256");
}

/**
 * Membedakan "kata sandi salah" dari "berkas rusak" adalah tebakan terdidik,
 * bukan kepastian: Fernet memakai satu HMAC untuk keduanya, jadi keduanya
 * gagal dengan cara yang persis sama.
 *
 * Yang bisa dipisahkan dengan pasti hanyalah kerusakan STRUKTUR — panjang
 * tidak masuk akal, versi bukan 0x80, ciphertext bukan kelipatan blok AES.
 * Itu jelas bukan soal kata sandi. Bila struktur utuh tapi HMAC gagal,
 * penyebab yang jauh lebih sering adalah kata sandi, jadi itu yang disebut
 * lebih dulu — dengan tetap menyinggung kemungkinan berkas berubah.
 */
export function decryptEnc(buffer: Buffer, password: string): string {
  const saltLen = config.enc.saltBytes;

  // Salt + versi + timestamp + IV + minimal 1 blok + HMAC.
  const minimum = saltLen + 1 + 8 + 16 + 16 + 32;
  if (buffer.length < minimum) fail("bukan_format_ini");

  const salt = buffer.subarray(0, saltLen);
  const token = buffer.subarray(saltLen);

  if (token[0] !== 0x80) fail("bukan_format_ini");

  const body = token.subarray(0, token.length - 32);
  const mac = token.subarray(token.length - 32);
  const iv = token.subarray(9, 25);
  const ciphertext = token.subarray(25, token.length - 32);

  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) fail("berkas_rusak");

  const key = deriveKey(password, salt);
  const signingKey = key.subarray(0, 16);
  const encryptionKey = key.subarray(16, 32);

  const expected = createHmac("sha256", signingKey).update(body).digest();
  if (expected.length !== mac.length || !timingSafeEqual(expected, mac)) {
    // Struktur utuh, HMAC gagal. Tidak dapat dipastikan yang mana.
    fail("kata_sandi_salah");
  }

  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv("aes-128-cbc", encryptionKey, iv);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // HMAC lolos tapi padding rusak berarti muatannya memang cacat.
    fail("berkas_rusak");
  }

  return plaintext.toString("utf8");
}
