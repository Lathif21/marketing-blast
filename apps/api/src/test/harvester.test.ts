import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HARVESTER_COLUMNS,
  isHarvesterFile,
  hostFromWebsite,
  splitOtherEmails,
} from "../import/harvester.js";

test("13 kolom lengkap terdeteksi sebagai Contact Harvester", () => {
  assert.equal(HARVESTER_COLUMNS.length, 13);
  assert.equal(isHarvesterFile([...HARVESTER_COLUMNS]), true);
});

test("urutan kolom yang berbeda tetap terdeteksi", () => {
  assert.equal(isHarvesterFile([...HARVESTER_COLUMNS].reverse()), true);
});

test("huruf besar dan spasi berlebih tetap terdeteksi", () => {
  assert.equal(
    isHarvesterFile(HARVESTER_COLUMNS.map((c) => ` ${c.toUpperCase()} `)),
    true,
  );
});

test("satu kolom hilang membuat deteksi gagal", () => {
  assert.equal(isHarvesterFile(HARVESTER_COLUMNS.slice(1)), false);
});

test("berkas CSV biasa tidak terdeteksi", () => {
  assert.equal(isHarvesterFile(["email_bisnis", "nama_perusahaan", "kota"]), false);
});

test("host diambil tanpa www dan tanpa skema", () => {
  assert.equal(hostFromWebsite("https://www.Contoh.co.id/a/b"), "contoh.co.id");
  assert.equal(hostFromWebsite("contoh.id"), "contoh.id");
  assert.equal(hostFromWebsite(""), "");
  assert.equal(hostFromWebsite("bukan url sama sekali"), "");
});

test("other_emails dipisah titik koma", () => {
  assert.deepEqual(splitOtherEmails("a@x.id; b@x.id ;"), ["a@x.id", "b@x.id"]);
  assert.deepEqual(splitOtherEmails(""), []);
});
