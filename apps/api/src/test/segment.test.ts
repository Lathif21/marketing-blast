// Penerjemah segment_filter.
//
// Diuji terpisah karena satu fungsi ini menentukan siapa yang menerima email.
// Kesalahan di sini tidak menghasilkan galat — ia menghasilkan kampanye yang
// terkirim ke orang yang salah.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAKS_PILIH_MANUAL, kondisiSegmen } from "../campaign/segment.js";

const UUID_A = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const UUID_B = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";

test("filter kosong tidak menambah kondisi apa pun", () => {
  const { kondisi, params } = kondisiSegmen({});
  assert.deepEqual(kondisi, []);
  assert.deepEqual(params, []);
});

test("sumber izin dan domain menjadi parameter terikat, bukan disisipkan", () => {
  const { kondisi, params } = kondisiSegmen({
    consent_source: "formulir_web",
    domain: "contoh.id",
  });
  assert.deepEqual(kondisi, ["c.consent_source = $1", "c.domain = $2"]);
  assert.deepEqual(params, ["formulir_web", "contoh.id"]);
});

test("penomoran parameter menyambung dari yang sudah dipakai pemanggil", () => {
  // susunAntrean sudah memakai $1 untuk campaignId.
  const { kondisi, params } = kondisiSegmen({ domain: "contoh.id" }, 1);
  assert.deepEqual(kondisi, ["c.domain = $2"]);
  assert.deepEqual(params, ["contoh.id"]);
});

test("contact_ids menjadi satu parameter array uuid", () => {
  const { kondisi, params } = kondisiSegmen({ contact_ids: [UUID_A, UUID_B] });
  assert.deepEqual(kondisi, ["c.id = ANY($1::uuid[])"]);
  assert.deepEqual(params, [[UUID_A, UUID_B]]);
});

test("daftar kosong berarti TIDAK ADA penerima, bukan tanpa pembatasan", () => {
  // Ini kasus yang paling mahal kalau salah: menganggap daftar kosong sebagai
  // "tanpa filter" akan mengirim ke SELURUH basis kontak justru saat pengguna
  // mengira tidak memilih siapa pun.
  const { kondisi, params } = kondisiSegmen({ contact_ids: [] });
  assert.equal(kondisi.length, 1);
  assert.deepEqual(params, [[]]);
});

test("nilai yang bukan UUID dibuang, tidak diteruskan ke query", () => {
  const { params } = kondisiSegmen({
    contact_ids: [UUID_A, "bukan-uuid", "1 OR 1=1", "", null, 42],
  });
  assert.deepEqual(params, [[UUID_A]]);
});

test("id ganda dihitung sekali", () => {
  const { params } = kondisiSegmen({ contact_ids: [UUID_A, UUID_A, UUID_B] });
  assert.deepEqual(params, [[UUID_A, UUID_B]]);
});

test("jumlah id dibatasi", () => {
  const banyak = Array.from({ length: MAKS_PILIH_MANUAL + 500 }, (_, i) =>
    `3f2504e0-4f89-11d3-9a0c-${String(i).padStart(12, "0")}`,
  );
  const { params } = kondisiSegmen({ contact_ids: banyak });
  assert.equal((params[0] as string[]).length, MAKS_PILIH_MANUAL);
});

test("contact_ids yang bukan array diabaikan", () => {
  assert.deepEqual(kondisiSegmen({ contact_ids: "semua" }).kondisi, []);
  assert.deepEqual(kondisiSegmen({ contact_ids: 5 }).kondisi, []);
});

test("kunci tak dikenal tidak melonggarkan filter", () => {
  const { kondisi } = kondisiSegmen({ kirim_ke_semua: true, status: "aktif" });
  assert.deepEqual(kondisi, []);
});

test("kriteria digabung, bukan saling menggantikan", () => {
  const { kondisi, params } = kondisiSegmen({
    consent_source: "pameran",
    contact_ids: [UUID_A],
  });
  assert.deepEqual(kondisi, ["c.consent_source = $1", "c.id = ANY($2::uuid[])"]);
  assert.deepEqual(params, ["pameran", [UUID_A]]);
});

// ── Kriteria tindak lanjut ───────────────────────────────────────────────────

test("respons_kampanye menjadi EXISTS atas kampanye induk", () => {
  const { kondisi, params } = kondisiSegmen({
    respons_kampanye: { campaign_id: UUID_A, pemicu: "membalas", jeda_jam: 48 },
  });
  assert.equal(kondisi.length, 1);
  assert.ok(kondisi[0].includes("EXISTS"));
  assert.ok(kondisi[0].includes("rk.replied_at IS NOT NULL"));
  assert.ok(kondisi[0].includes("make_interval(hours => $2)"));
  assert.deepEqual(params, [UUID_A, 48]);
});

test("setiap pemicu memetakan ke kolom waktunya sendiri", () => {
  const kolom = (pemicu: string) =>
    kondisiSegmen({ respons_kampanye: { campaign_id: UUID_A, pemicu, jeda_jam: 0 } }).kondisi[0];

  assert.ok(kolom("dibuka").includes("rk.opened_at IS NOT NULL"));
  assert.ok(kolom("diklik").includes("rk.clicked_at IS NOT NULL"));
  assert.ok(
    kolom("apa_saja").includes("GREATEST(rk.opened_at, rk.clicked_at, rk.replied_at)"),
  );
});

test("pemicu tak dikenal menjadi kondisi yang tidak pernah benar", () => {
  // Kasus paling mahal di kriteria ini: kriteria yang menguap diam-diam
  // mengubah kampanye tindak lanjut menjadi kiriman ke SELURUH basis kontak.
  const { kondisi, params } = kondisiSegmen({
    respons_kampanye: { campaign_id: UUID_A, pemicu: "ditelepon", jeda_jam: 1 },
  });
  assert.deepEqual(kondisi, ["false"]);
  assert.deepEqual(params, []);
});

test("induk yang bukan UUID juga menghasilkan kondisi yang tidak pernah benar", () => {
  assert.deepEqual(
    kondisiSegmen({ respons_kampanye: { campaign_id: "semua", pemicu: "dibuka" } }).kondisi,
    ["false"],
  );
});

test("jeda dijepit dan tidak pernah negatif", () => {
  const jeda = (v: unknown) =>
    kondisiSegmen({ respons_kampanye: { campaign_id: UUID_A, pemicu: "dibuka", jeda_jam: v } })
      .params[1];

  assert.equal(jeda(-5), 0);
  assert.equal(jeda("bukan angka"), 0);
  assert.equal(jeda(24 * 365), 24 * 90);
  assert.equal(jeda(12.9), 12);
});

test("respons menyaring atas penilaian kontak", () => {
  const { kondisi, params } = kondisiSegmen({ respons: "tertarik" });
  assert.deepEqual(kondisi, ["c.respons = $1::respons_kontak"]);
  assert.deepEqual(params, ["tertarik"]);
});

test("nilai respons yang tidak dikenal diabaikan, bukan diteruskan ke SQL", () => {
  assert.deepEqual(kondisiSegmen({ respons: "penasaran" }).kondisi, []);
});

test("kecuali_respons membuang keadaan yang disebut", () => {
  const { kondisi, params } = kondisiSegmen({ kecuali_respons: ["diam", "menolak", "ngawur"] });
  assert.deepEqual(kondisi, ["c.respons <> ALL($1::respons_kontak[])"]);
  assert.deepEqual(params, [["diam", "menolak"]]);
});
