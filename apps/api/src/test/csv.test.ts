import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toRecords, detectDelimiter } from "../lib/csv.js";

test("field berkutip boleh berisi koma", () => {
  const { header, rows } = parseCsv('a,b\n"PT Maju, Jaya",x');
  assert.deepEqual(header, ["a", "b"]);
  assert.deepEqual(rows, [["PT Maju, Jaya", "x"]]);
});

test("kutip ganda di dalam kutip menjadi satu kutip", () => {
  const { rows } = parseCsv('a\n"dia bilang ""halo"""');
  assert.deepEqual(rows, [['dia bilang "halo"']]);
});

test("baris baru di dalam field berkutip tidak memotong baris", () => {
  const { rows } = parseCsv('a,b\n"baris1\nbaris2",x');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], ["baris1\nbaris2", "x"]);
});

test("CRLF diperlakukan sama dengan LF", () => {
  const { rows } = parseCsv("a,b\r\n1,2\r\n3,4\r\n");
  assert.deepEqual(rows, [
    ["1", "2"],
    ["3", "4"],
  ]);
});

test("BOM UTF-8 dari Excel tidak ikut ke nama kolom", () => {
  const { header } = parseCsv("﻿email,company\na@b.id,X");
  assert.deepEqual(header, ["email", "company"]);
});

test("baris terakhir tanpa newline tetap terbaca", () => {
  const { rows } = parseCsv("a,b\n1,2");
  assert.deepEqual(rows, [["1", "2"]]);
});

test("baris kosong tidak menjadi kontak kosong", () => {
  const { rows } = parseCsv("a,b\n1,2\n\n3,4\n\n");
  assert.deepEqual(rows, [
    ["1", "2"],
    ["3", "4"],
  ]);
});

test("titik koma terdeteksi sebagai pemisah", () => {
  assert.equal(detectDelimiter("a;b;c"), ";");
  assert.equal(detectDelimiter("a,b,c"), ",");
  const { header } = parseCsv("email;company\na@b.id;X");
  assert.deepEqual(header, ["email", "company"]);
});

test("pemisah di dalam kutip tidak ikut dihitung saat deteksi", () => {
  assert.equal(detectDelimiter('"a;b;c;d";x'), ";");
});

test("toRecords memasangkan kolom dan memangkas spasi", () => {
  const records = toRecords(parseCsv("email, company \n a@b.id , PT X "));
  assert.deepEqual(records, [{ email: "a@b.id", company: "PT X" }]);
});

test("kolom yang kurang menjadi string kosong, bukan undefined", () => {
  const records = toRecords(parseCsv("a,b,c\n1,2"));
  assert.deepEqual(records, [{ a: "1", b: "2", c: "" }]);
});
