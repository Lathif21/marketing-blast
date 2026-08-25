import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

process.env.DATABASE_URL ??= "postgres://x:y@localhost:5432/z";
process.env.UNSUBSCRIBE_SECRET ??= "rahasia-uji-yang-cukup-panjang-32chr";
process.env.ENC_SALT_BYTES = "16";
process.env.ENC_PBKDF2_ITERATIONS = "1000";

const { decryptEnc, DecryptError } = await import("../lib/fernet.js");

/**
 * Membentuk berkas .enc seperti yang dihasilkan Contact Harvester:
 * salt di depan, diikuti token Fernet.
 */
function buildEnc(plaintext: string, password: string): Buffer {
  const salt = randomBytes(16);
  const key = pbkdf2Sync(password, salt, 1000, 32, "sha256");
  const signingKey = key.subarray(0, 16);
  const encryptionKey = key.subarray(16, 32);

  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-128-cbc", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));

  const body = Buffer.concat([Buffer.from([0x80]), timestamp, iv, ciphertext]);
  const mac = createHmac("sha256", signingKey).update(body).digest();
  return Buffer.concat([salt, body, mac]);
}

const CSV = "company,email\nPT Contoh,a@contoh.id\n";

test("berkas yang sah terdekripsi kembali menjadi isi aslinya", () => {
  assert.equal(decryptEnc(buildEnc(CSV, "sandi-benar"), "sandi-benar"), CSV);
});

test("isi dengan karakter non-ASCII bertahan utuh", () => {
  const isi = "company,email\nPT Sejahtera Ábádí,üser@contoh.id\n";
  assert.equal(decryptEnc(buildEnc(isi, "s"), "s"), isi);
});

test("kata sandi salah dilaporkan sebagai kata sandi salah", () => {
  assert.throws(
    () => decryptEnc(buildEnc(CSV, "benar"), "salah"),
    (err: unknown) => err instanceof DecryptError && err.kind === "kata_sandi_salah",
  );
});

test("berkas terpotong dibedakan dari kata sandi salah", () => {
  const enc = buildEnc(CSV, "s");
  assert.throws(
    () => decryptEnc(enc.subarray(0, 20), "s"),
    (err: unknown) => err instanceof DecryptError && err.kind === "bukan_format_ini",
  );
});

test("versi Fernet yang salah dilaporkan sebagai bukan format ini", () => {
  const enc = buildEnc(CSV, "s");
  enc[16] = 0x79;
  assert.throws(
    () => decryptEnc(enc, "s"),
    (err: unknown) => err instanceof DecryptError && err.kind === "bukan_format_ini",
  );
});

test("ciphertext yang panjangnya bukan kelipatan blok dilaporkan rusak", () => {
  const enc = buildEnc(CSV, "s");
  const rusak = Buffer.concat([
    enc.subarray(0, enc.length - 33),
    enc.subarray(enc.length - 32),
  ]);
  assert.throws(
    () => decryptEnc(rusak, "s"),
    (err: unknown) => err instanceof DecryptError && err.kind === "berkas_rusak",
  );
});

test("pesan galat memakai bahasa yang dapat ditindaklanjuti pengguna", () => {
  try {
    decryptEnc(buildEnc(CSV, "benar"), "salah");
    assert.fail("seharusnya melempar");
  } catch (err) {
    assert.match((err as Error).message, /[Kk]ata sandi/);
  }
});
