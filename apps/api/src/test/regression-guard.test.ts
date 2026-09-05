// Penjaga yang mencegah uji regresi menghapus isi basis data pengembangan.
//
// Diuji karena pernah gagal: versi pertama memeriksa `process.env` sementara
// kolam koneksi memakai nilai yang ditangkap `config.ts` lebih awal. Penjaga
// lolos, dan seluruh kontak hasil impor tetap terhapus.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SUFIKS_UJI,
  gantiNamaBasisData,
  namaBasisData,
  pastikanBasisDataUji,
} from "../scripts/regression-guard.js";

const DEV = "postgres://u:p@127.0.0.1:55432/marketing_blast";
const UJI = `postgres://u:p@127.0.0.1:55432/marketing_blast${SUFIKS_UJI}`;

test("basis data pengembangan ditolak", () => {
  assert.throws(() => pastikanBasisDataUji(DEV), /menolak berjalan/);
});

test("nama basis data disebut dalam pesan galat", () => {
  assert.throws(() => pastikanBasisDataUji(DEV), /marketing_blast/);
});

test("basis data uji diterima", () => {
  assert.doesNotThrow(() => pastikanBasisDataUji(UJI));
});

test("nama yang hanya MENGANDUNG suffix di tengah tetap ditolak", () => {
  assert.throws(
    () => pastikanBasisDataUji(`postgres://u:p@h:5432/a${SUFIKS_UJI}_produksi`),
    /menolak berjalan/,
  );
});

test("basis data produksi tanpa suffix ditolak", () => {
  for (const nama of ["postgres", "marketing_blast_prod", "blast"]) {
    assert.throws(
      () => pastikanBasisDataUji(`postgres://u:p@h:5432/${nama}`),
      /menolak berjalan/,
      `seharusnya menolak: ${nama}`,
    );
  }
});

test("nama basis data diambil dari path, bukan dari host", () => {
  assert.equal(namaBasisData("postgres://u:p@marketing_blast:5432/lain"), "lain");
});

test("penggantian nama tidak merusak kredensial atau port", () => {
  const hasil = gantiNamaBasisData(DEV, "marketing_blast_regresi");
  const u = new URL(hasil);
  assert.equal(u.pathname, "/marketing_blast_regresi");
  assert.equal(u.port, "55432");
  assert.equal(u.username, "u");
  assert.equal(u.password, "p");
});
