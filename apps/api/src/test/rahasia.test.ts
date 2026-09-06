// Enkripsi token penyegar Gmail.
//
// Yang dilindungi di sini bukan kredensial layanan kita, melainkan akses ke
// kotak masuk seseorang. Karena itu yang diuji bukan hanya "bisa dibuka lagi",
// tapi juga bahwa ciphertext yang diubah DITOLAK — bukan dibuka menjadi sampah
// yang lalu dikirim ke Google sebagai token.
//
// `config` menangkap variabel lingkungan saat modulnya dievaluasi, jadi
// nilainya disetel lebih dulu dan modulnya diimpor secara dinamis. Impor biasa
// akan terangkat ke atas berkas dan berjalan sebelum baris mana pun di sini.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TOKEN_SECRET = "kunci-uji-yang-cukup-panjang-untuk-scrypt-0123456789";
process.env.UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET ?? "x".repeat(64);
// `config` menolak start tanpa DATABASE_URL, dan enkripsi membaca config.
// Nilainya tidak pernah dipakai menyambung: uji ini tidak menyentuh basis data.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://uji:uji@127.0.0.1:1/tidak_disambungkan";

const { enkripsi, dekripsi } = await import("../lib/rahasia.js");
const { buatState, bacaState } = await import("../gmail/oauth.js");
const { createHmac } = await import("node:crypto");

const TENANT = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const PENGGUNA = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";

test("token dapat dibuka kembali persis seperti aslinya", () => {
  const asli = "1//0gTokenPenyegarPanjangDariGoogle_-abcDEF123";
  assert.equal(dekripsi(enkripsi(asli)), asli);
});

test("dua enkripsi atas nilai yang sama menghasilkan ciphertext berbeda", () => {
  // IV acak per pesan. Tanpa itu, dua pelanggan yang kebetulan punya token
  // sama akan terlihat sama di basis data — dan pola itu sendiri informasi.
  const a = enkripsi("token-yang-sama");
  const b = enkripsi("token-yang-sama");
  assert.notEqual(a, b);
  assert.equal(dekripsi(a), dekripsi(b));
});

test("ciphertext yang diubah DITOLAK, bukan dibuka menjadi sampah", () => {
  const asli = enkripsi("token-penting");
  const bagian = asli.split(".");

  // Membalik satu karakter pada muatannya.
  const isi = Buffer.from(bagian[3], "base64url");
  isi[0] ^= 0xff;
  bagian[3] = isi.toString("base64url");

  assert.equal(dekripsi(bagian.join(".")), null);
});

test("tag autentikasi yang diubah juga ditolak", () => {
  const bagian = enkripsi("token-penting").split(".");
  const tag = Buffer.from(bagian[2], "base64url");
  tag[0] ^= 0xff;
  bagian[2] = tag.toString("base64url");
  assert.equal(dekripsi(bagian.join(".")), null);
});

test("bentuk yang tidak dikenali menghasilkan null, bukan lemparan", () => {
  // Pemanggilnya pekerjaan latar yang menyapu banyak pelanggan; satu baris
  // rusak harus menjadi satu koneksi bermasalah, bukan lemparan yang
  // menghentikan sinkronisasi pelanggan lain.
  for (const rusak of ["", "bukan-token", "v2.a.b.c", "v1.a.b", "v1...."]) {
    assert.equal(dekripsi(rusak), null, rusak);
  }
});

// ── state OAuth ──────────────────────────────────────────────────────────────

test("state yang sah terbaca kembali beserta asalnya", () => {
  const hasil = bacaState(buatState(TENANT, PENGGUNA));
  assert.deepEqual(hasil, { tenantId: TENANT, userId: PENGGUNA });
});

test("state yang diubah ditolak", () => {
  // Inilah yang menahan serangan di mana korban dipancing membuka URL callback
  // berisi kode milik akun Google penyerang.
  const state = buatState(TENANT, PENGGUNA);
  const titik = state.lastIndexOf(".");
  const muatan = state.slice(0, titik);

  assert.equal(bacaState(`${muatan}.tandaTanganPalsu`), null);
  assert.equal(bacaState(`${muatan}x.${state.slice(titik + 1)}`), null);
  assert.equal(bacaState("tanpa-titik"), null);
  assert.equal(bacaState(""), null);
});

test("state kedaluwarsa ditolak", () => {
  const lampau = Math.floor(Date.now() / 1000) - 60;
  const muatan = Buffer.from(
    JSON.stringify({ tenantId: TENANT, userId: PENGGUNA, sampai: lampau }),
    "utf8",
  ).toString("base64url");

  // Ditandatangani dengan benar — yang gagal murni umurnya, bukan tanda
  // tangannya.
  const tanda = createHmac("sha256", process.env.TOKEN_SECRET as string)
    .update(muatan)
    .digest("base64url");

  assert.equal(bacaState(`${muatan}.${tanda}`), null);
});
