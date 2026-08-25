import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://x:y@localhost:5432/z";
process.env.UNSUBSCRIBE_SECRET ??= "rahasia-uji-yang-cukup-panjang-32chr";

const { terapkanPersonalisasi, penandaTidakTerisi, susunPesan } = await import(
  "../campaign/compose.js"
);

test("penanda diganti nilai kontak", () => {
  const hasil = terapkanPersonalisasi("Halo {{nama_perusahaan}}", {
    nama_perusahaan: "PT Contoh",
  });
  assert.equal(hasil, "Halo PT Contoh");
});

test("penanda tanpa nilai dibiarkan apa adanya, bukan dikosongkan", () => {
  // Kalimat yang kehilangan kata tanpa disadari lebih berbahaya daripada
  // penanda yang terlihat jelas belum terisi.
  const hasil = terapkanPersonalisasi("Halo {{nama_pic}}", { nama_perusahaan: "PT Contoh" });
  assert.equal(hasil, "Halo {{nama_pic}}");
});

test("nilai kosong diperlakukan sama dengan tidak ada", () => {
  const hasil = terapkanPersonalisasi("Halo {{nama_perusahaan}}", { nama_perusahaan: "" });
  assert.equal(hasil, "Halo {{nama_perusahaan}}");
});

test("spasi di dalam penanda ditoleransi", () => {
  assert.equal(
    terapkanPersonalisasi("{{ nama_perusahaan }}", { nama_perusahaan: "PT A" }),
    "PT A",
  );
});

test("penandaTidakTerisi melaporkan yang kosong saja", () => {
  const hilang = penandaTidakTerisi("{{nama_perusahaan}} dan {{nama_pic}}", {
    nama_perusahaan: "PT A",
  });
  assert.deepEqual(hilang, ["nama_pic"]);
});

test("footer identitas dan tautan berhenti selalu tersisip", () => {
  const pesan = susunPesan({
    subject: "Penawaran",
    bodyText: "Isi pesan.",
    data: {},
    contactId: "11111111-1111-4111-8111-111111111111",
  });

  assert.match(pesan.textBody, /Berhenti menerima email ini: https?:\/\//);
  assert.ok(pesan.textBody.includes("Isi pesan."));
});

test("footer tersisip meski isi pesan kosong", () => {
  // Tidak ada parameter untuk mematikan footer, dan pesan kosong pun tetap
  // membawanya. Ini yang membuat aturan §1 tidak dapat dilewati dari editor.
  const pesan = susunPesan({
    subject: "x",
    bodyText: "",
    data: {},
    contactId: "22222222-2222-4222-8222-222222222222",
  });
  assert.match(pesan.textBody, /Berhenti menerima email ini/);
});

test("dua kontak berbeda mendapat tautan berhenti berbeda", () => {
  const a = susunPesan({
    subject: "x", bodyText: "y", data: {},
    contactId: "33333333-3333-4333-8333-333333333333",
  });
  const b = susunPesan({
    subject: "x", bodyText: "y", data: {},
    contactId: "44444444-4444-4444-8444-444444444444",
  });

  const url = (s: string) => s.match(/https?:\/\/\S+/)?.[0];
  assert.notEqual(url(a.textBody), url(b.textBody));
});

test("subject ikut dipersonalisasi", () => {
  const pesan = susunPesan({
    subject: "Untuk {{nama_perusahaan}}",
    bodyText: "isi",
    data: { nama_perusahaan: "PT B" },
    contactId: "55555555-5555-4555-8555-555555555555",
  });
  assert.equal(pesan.subject, "Untuk PT B");
});

test("html footer hanya dibuat bila ada bodyHtml", () => {
  const tanpa = susunPesan({
    subject: "x", bodyText: "y", data: {},
    contactId: "66666666-6666-4666-8666-666666666666",
  });
  assert.equal(tanpa.htmlBody, undefined);

  const dengan = susunPesan({
    subject: "x", bodyText: "y", bodyHtml: "<p>y</p>", data: {},
    contactId: "77777777-7777-4777-8777-777777777777",
  });
  assert.match(dengan.htmlBody ?? "", /Berhenti menerima email ini/);
});
