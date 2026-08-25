import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://x:y@localhost:5432/z";
process.env.UNSUBSCRIBE_SECRET ??= "rahasia-uji-yang-cukup-panjang-32chr";

const { createUnsubscribeToken, verifyUnsubscribeToken } = await import("../lib/tokens.js");

const ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

test("token yang dibuat dapat diverifikasi kembali", () => {
  assert.equal(verifyUnsubscribeToken(createUnsubscribeToken(ID)), ID);
});

test("token yang diubah satu karakter ditolak", () => {
  const token = createUnsubscribeToken(ID);
  const rusak = token.slice(0, -1) + (token.at(-1) === "A" ? "B" : "A");
  assert.equal(verifyUnsubscribeToken(rusak), null);
});

test("mengganti contact_id tanpa tanda tangan baru ditolak", () => {
  const token = createUnsubscribeToken(ID);
  const sig = token.split(".")[1];
  const lain = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";
  assert.equal(verifyUnsubscribeToken(`${lain}.${sig}`), null);
});

test("bentuk yang bukan token ditolak tanpa melempar", () => {
  for (const bad of ["", ".", "abc", `${ID}.`, ".x", ID, "a.b.c"]) {
    assert.equal(verifyUnsubscribeToken(bad), null, `gagal untuk: ${JSON.stringify(bad)}`);
  }
});

test("contact_id yang bukan UUID ditolak sebelum menyentuh query", () => {
  assert.equal(verifyUnsubscribeToken("bukan-uuid.tandatangan"), null);
  assert.equal(verifyUnsubscribeToken("1 OR 1=1.tandatangan"), null);
});

test("token stabil untuk id yang sama", () => {
  assert.equal(createUnsubscribeToken(ID), createUnsubscribeToken(ID));
});
