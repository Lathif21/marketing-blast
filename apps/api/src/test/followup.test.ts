// Segmen efektif kampanye tindak lanjut.
//
// Diuji terpisah karena tiga pemakai bergantung padanya — penyusunan antrean,
// pemeriksaan pra-kirim, dan pendaftaran bergulir. Kalau ketiganya melihat
// himpunan penerima yang berbeda, angka yang dipakai memutuskan boleh-tidaknya
// mengirim bukan angka yang benar-benar dikirimi.

import { test } from "node:test";
import assert from "node:assert/strict";
import { JEDA_BAWAAN_JAM, filterEfektif, pemicuSah } from "../campaign/followup.js";

const INDUK = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

test("kampanye biasa memakai segment_filter apa adanya", () => {
  const filter = filterEfektif({
    parent_campaign_id: null,
    pemicu: null,
    jeda_lanjutan_jam: 24,
    segment_filter: { domain: "contoh.id" },
  });
  assert.deepEqual(filter, { domain: "contoh.id" });
});

test("kampanye tindak lanjut menambahkan kriteria reaksi atas induknya", () => {
  const filter = filterEfektif({
    parent_campaign_id: INDUK,
    pemicu: "membalas",
    jeda_lanjutan_jam: 48,
    segment_filter: {},
  });
  assert.deepEqual(filter, {
    respons_kampanye: { campaign_id: INDUK, pemicu: "membalas", jeda_jam: 48 },
  });
});

test("kriteria tindak lanjut menambah, tidak menggantikan segmen yang ada", () => {
  const filter = filterEfektif({
    parent_campaign_id: INDUK,
    pemicu: "dibuka",
    jeda_lanjutan_jam: JEDA_BAWAAN_JAM,
    segment_filter: { consent_source: "pameran" },
  });
  assert.equal(filter.consent_source, "pameran");
  assert.ok(filter.respons_kampanye);
});

test("induk tanpa pemicu tidak menghasilkan kriteria setengah jadi", () => {
  // Bentuk ini ditolak CHECK di migrasi 009, tapi fungsinya tidak boleh
  // bergantung pada itu: menghasilkan kriteria tanpa pemicu berarti menyusun
  // SQL dari kolom yang tidak pernah ditentukan.
  const filter = filterEfektif({
    parent_campaign_id: INDUK,
    pemicu: null,
    jeda_lanjutan_jam: 24,
    segment_filter: { domain: "contoh.id" },
  });
  assert.deepEqual(filter, { domain: "contoh.id" });
});

test("hanya pemicu yang dikenali yang diterima", () => {
  assert.ok(pemicuSah("membalas"));
  assert.ok(pemicuSah("apa_saja"));
  assert.equal(pemicuSah("semua"), false);
  assert.equal(pemicuSah(""), false);
  assert.equal(pemicuSah(null), false);
});
