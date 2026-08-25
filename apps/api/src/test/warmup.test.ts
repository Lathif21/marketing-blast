import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batasHarian,
  tanggalMuat,
  WARMUP_STAGES,
  TOTAL_STAGES,
} from "../domain/warmup.js";

test("volume yang muat hari ini tidak menghasilkan tanggal tunda", () => {
  assert.equal(tanggalMuat(500, 200), null);
  assert.equal(tanggalMuat(500, 500), null);
});

test("tahap tanpa batas tidak pernah menunda", () => {
  assert.equal(tanggalMuat(null, 1_000_000), null);
});

test("volume melebihi kuota menghasilkan tanggal di masa depan", () => {
  const hasil = tanggalMuat(100, 350);
  assert.ok(hasil !== null);
  assert.ok(hasil! > new Date().toISOString().slice(0, 10));
});

test("batas harian naik di setiap tahap", () => {
  const batas = WARMUP_STAGES.map((s) => s.dailyLimit).filter(
    (b): b is number => b !== null,
  );
  for (let i = 1; i < batas.length; i += 1) {
    assert.ok(batas[i] > batas[i - 1], `tahap ${i + 1} tidak lebih besar dari ${i}`);
  }
});

test("tahap terakhir tidak punya batas tetap", () => {
  assert.equal(batasHarian(TOTAL_STAGES), null);
});

test("tahap di luar daftar dianggap tanpa batas tersimpan", () => {
  // Nilai tak dikenal tidak boleh menghasilkan batas yang mengada-ada.
  assert.equal(batasHarian(99), null);
});

test("tahap awal adalah yang paling ketat", () => {
  assert.equal(batasHarian(1), 50);
});
