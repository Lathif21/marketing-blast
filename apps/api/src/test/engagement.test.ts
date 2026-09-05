// Penilaian respons kontak.
//
// Fungsi ini yang memutuskan siapa yang ditindaklanjuti dan siapa yang
// dihiraukan. Salahnya tidak menghasilkan galat — hanya email yang sampai ke
// orang yang sudah tidak ingin menerimanya, atau tindak lanjut yang tidak
// pernah sampai ke orang yang sudah menjawab.

import { test } from "node:test";
import assert from "node:assert/strict";
import { JENDELA_DIAM_HARI, klasifikasi } from "../campaign/engagement.js";

const SEKARANG = new Date("2026-03-01T00:00:00Z");
const hariLalu = (n: number) => new Date(SEKARANG.getTime() - n * 24 * 60 * 60 * 1000);

test("belum pernah dikirimi berarti belum ada yang dapat dinilai", () => {
  const hasil = klasifikasi(
    { terakhirDikirim: null, terakhirBereaksi: null, menolak: false },
    SEKARANG,
  );
  assert.equal(hasil, "belum_ada");
});

test("reaksi apa pun menjadikan kontak tertarik", () => {
  const hasil = klasifikasi(
    { terakhirDikirim: hariLalu(10), terakhirBereaksi: hariLalu(9), menolak: false },
    SEKARANG,
  );
  assert.equal(hasil, "tertarik");
});

test("penolakan mengalahkan reaksi, bukan sebaliknya", () => {
  // Membuka email lalu menandainya spam. Yang berlaku adalah penolakannya —
  // mengirimi tindak lanjut karena "toh pernah membuka" adalah cara tercepat
  // mengubah satu keluhan menjadi beberapa.
  const hasil = klasifikasi(
    { terakhirDikirim: hariLalu(5), terakhirBereaksi: hariLalu(4), menolak: true },
    SEKARANG,
  );
  assert.equal(hasil, "menolak");
});

test("belum melewati jendela berarti masih menunggu, bukan diam", () => {
  const hasil = klasifikasi(
    { terakhirDikirim: hariLalu(JENDELA_DIAM_HARI - 1), terakhirBereaksi: null, menolak: false },
    SEKARANG,
  );
  assert.equal(hasil, "menunggu");
});

test("tepat di batas jendela sudah dinyatakan diam", () => {
  const hasil = klasifikasi(
    { terakhirDikirim: hariLalu(JENDELA_DIAM_HARI), terakhirBereaksi: null, menolak: false },
    SEKARANG,
  );
  assert.equal(hasil, "diam");
});

test("reaksi lama tidak luntur menjadi diam", () => {
  // Kalau tindak lanjutnya terlambat, itu masalah jadwal kampanye — bukan
  // alasan menghapus fakta bahwa orangnya pernah menjawab.
  const hasil = klasifikasi(
    { terakhirDikirim: hariLalu(200), terakhirBereaksi: hariLalu(199), menolak: false },
    SEKARANG,
  );
  assert.equal(hasil, "tertarik");
});

test("kontak yang belum pernah dikirimi tapi sudah tertekan tetap menolak", () => {
  // Alamat bisa masuk daftar penekanan lewat jalur lain, misalnya diimpor
  // ulang setelah berhenti berlangganan pada kampanye sebelumnya.
  const hasil = klasifikasi(
    { terakhirDikirim: null, terakhirBereaksi: null, menolak: true },
    SEKARANG,
  );
  assert.equal(hasil, "menolak");
});
