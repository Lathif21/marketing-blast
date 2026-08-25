import { test } from "node:test";
import assert from "node:assert/strict";
import { collectEmails, validateRows, isValidEmail, type RowInput } from "../import/validate.js";

const ctx = (over: Partial<Parameters<typeof validateRows>[1]> = {}) => ({
  existing: new Set<string>(),
  suppressed: new Set<string>(),
  fromHarvester: true,
  ...over,
});

const row = (over: Partial<RowInput> = {}): RowInput => ({
  email: "a@contoh.id",
  company: "PT Contoh",
  website: "https://contoh.id",
  emailSource: "found",
  sourceStatus: "ok",
  ...over,
});

test("format alamat tidak valid ditolak", () => {
  const s = validateRows([row({ email: "bukan-email" })], ctx());
  assert.equal(s.rejected, 1);
  assert.equal(s.rows[0].reason, "format_email_tidak_valid");
});

test("alamat kosong ditolak, nomor telepon tidak menyelamatkannya", () => {
  const s = validateRows([row({ email: "", phone: "+62811", whatsapp: "+62811" })], ctx());
  assert.equal(s.rejected, 1);
  assert.equal(s.rows[0].reason, "email_kosong");
});

test("alamat yang ada di daftar penekanan ditolak, tanpa opsi menimpa", () => {
  const s = validateRows([row()], ctx({ suppressed: new Set(["a@contoh.id"]) }));
  assert.equal(s.rejected, 1);
  assert.equal(s.rows[0].reason, "ada_di_penekanan");
});

test("penekanan diperiksa sebelum duplikat", () => {
  const s = validateRows(
    [row()],
    ctx({
      existing: new Set(["a@contoh.id"]),
      suppressed: new Set(["a@contoh.id"]),
    }),
  );
  assert.equal(s.rows[0].reason, "ada_di_penekanan");
});

test("alamat yang sudah ada dihitung duplikat", () => {
  const s = validateRows([row()], ctx({ existing: new Set(["a@contoh.id"]) }));
  assert.equal(s.duplicate, 1);
});

test("duplikat di dalam berkas yang sama juga tertangkap", () => {
  const s = validateRows([row(), row()], ctx());
  assert.equal(s.accepted, 1);
  assert.equal(s.duplicate, 1);
});

test("beda huruf besar-kecil tetap dihitung duplikat", () => {
  const s = validateRows([row({ email: "A@Contoh.ID" }), row({ email: "a@contoh.id" })], ctx());
  assert.equal(s.duplicate, 1);
});

test("status kolom sumber bukan ok membuat baris ditolak", () => {
  const s = validateRows([row({ sourceStatus: "blocked" })], ctx());
  assert.equal(s.rejected, 1);
  assert.equal(s.rows[0].reason, "status_sumber_bukan_ok");
});

test("status sumber diabaikan untuk berkas non-harvester", () => {
  const s = validateRows([row({ sourceStatus: "blocked" })], ctx({ fromHarvester: false }));
  assert.equal(s.rejected, 0);
});

test("email_source guessed diterima tapi berstatus karantina", () => {
  const s = validateRows([row({ emailSource: "guessed" })], ctx());
  assert.equal(s.rows[0].outcome, "diterima");
  assert.equal(s.rows[0].status, "karantina");
  assert.equal(s.rows[0].emailOrigin, "guessed");
  // Yang dihitung sebagai karantina adalah bagian guessed dari yang diterima.
  assert.equal(s.accepted, 1);
  assert.equal(s.quarantined, 1);
});

test("email_source found juga berstatus karantina sampai diverifikasi", () => {
  const s = validateRows([row({ emailSource: "found" })], ctx());
  assert.equal(s.rows[0].status, "karantina");
  assert.equal(s.rows[0].emailOrigin, "found");
  // found bukan alamat tebakan, jadi tidak dihitung di angka karantina.
  assert.equal(s.accepted, 1);
  assert.equal(s.quarantined, 0);
});

test("tidak ada baris yang lolos sebagai aktif langsung", () => {
  const s = validateRows(
    [row(), row({ email: "b@contoh.id" }), row({ email: "c@contoh.id" })],
    ctx(),
  );
  assert.equal(
    s.rows.every((r) => r.status !== "aktif"),
    true,
  );
});

test("other_emails menjadi baris terpisah dan selalu guessed", () => {
  const s = validateRows([row({ otherEmails: "info@contoh.id; sales@contoh.id" })], ctx());
  assert.equal(s.rows.length, 3);
  assert.equal(s.accepted, 3);
  assert.equal(s.quarantined, 2);
  const derived = s.rows.filter((r) => r.derivedFrom === "a@contoh.id");
  assert.equal(derived.length, 2);
  assert.equal(
    derived.every((r) => r.emailOrigin === "guessed"),
    true,
  );
});

test("domain diambil dari website, jatuh ke domain email bila website kosong", () => {
  const a = validateRows([row({ website: "https://www.Contoh.co.id/hubungi" })], ctx());
  assert.equal(a.rows[0].domain, "contoh.co.id");
  const b = validateRows([row({ website: "", email: "x@lain.id" })], ctx());
  assert.equal(b.rows[0].domain, "lain.id");
});

test("nomor telepon dan whatsapp disimpan sebagai rujukan, bukan kanal kirim", () => {
  const s = validateRows([row({ whatsapp: "+62811", phone: "021-555" })], ctx());
  assert.deepEqual(s.rows[0].referenceContact, { whatsapp: "+62811", phone: "021-555" });
});

test("validasi alamat menolak bentuk yang jelas salah", () => {
  for (const bad of ["a@b", "a b@c.id", "a@@b.id", "@b.id", "a@.id", "a@b_c.id", ""]) {
    assert.equal(isValidEmail(bad), false, `seharusnya ditolak: ${bad}`);
  }
  for (const good of ["a@b.id", "a.b+c@sub.contoh.co.id", "INFO@Contoh.ID"]) {
    assert.equal(isValidEmail(good), true, `seharusnya diterima: ${good}`);
  }
});

// ─── Regresi: alamat turunan wajib ikut diperiksa ────────────────────────────
//
// Pernah gagal di sini. Langkah validasi mengumpulkan alamat dari `email` DAN
// `other_emails`, tapi langkah commit hanya dari `email`. Akibatnya alamat
// turunan yang ada di daftar penekanan lolos tersimpan — validasi menolaknya,
// commit tetap menyimpannya. Uji ini menjaga kedua langkah memakai satu
// pengumpul yang sama.

test("collectEmails ikut mengumpulkan alamat dari other_emails", () => {
  const emails = collectEmails([
    row({ email: "utama@contoh.id", otherEmails: "info@contoh.id; sales@contoh.id" }),
  ]);
  assert.deepEqual(emails, ["utama@contoh.id", "info@contoh.id", "sales@contoh.id"]);
});

test("collectEmails membuang nilai kosong", () => {
  assert.deepEqual(collectEmails([row({ email: "", otherEmails: "" })]), []);
});

test("alamat turunan yang tertekan ditolak, bukan diterima", () => {
  const inputs = [row({ email: "utama@contoh.id", otherEmails: "info@contoh.id" })];
  // Persis seperti yang dilakukan rute: kumpulkan dulu, baru periksa.
  const dikumpulkan = collectEmails(inputs);
  assert.equal(dikumpulkan.includes("info@contoh.id"), true);

  const s = validateRows(inputs, ctx({ suppressed: new Set(["info@contoh.id"]) }));
  const turunan = s.rows.find((r) => r.email === "info@contoh.id");
  assert.equal(turunan?.outcome, "ditolak");
  assert.equal(turunan?.reason, "ada_di_penekanan");
  assert.equal(s.accepted, 1);
});
