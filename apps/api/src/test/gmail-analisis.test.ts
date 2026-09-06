// Penilaian korespondensi Gmail.
//
// Diuji terpisah karena satu fungsi ini yang memutuskan alamat mana yang boleh
// menjadi kontak atas dasar "kita pernah berkorespondensi". Salahnya tidak
// menghasilkan galat — ia menghasilkan kampanye yang terkirim ke orang yang
// tidak pernah berhubungan dengan tim, dengan dasar izin yang diklaim ada.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alamatDari,
  alamatOtomatis,
  analisis,
  kirimanMassal,
  namaDari,
  type PesanRingkas,
} from "../gmail/analisis.js";

const KITA = "sales@perusahaan.co.id";
const OPSI = { alamatSendiri: KITA, domainInternal: [] };

let nomor = 0;
function pesan(p: Partial<PesanRingkas> & { dari: string }): PesanRingkas {
  nomor += 1;
  return {
    id: `m${nomor}`,
    threadId: `t${nomor}`,
    waktu: 1_700_000_000_000 + nomor * 1000,
    kepada: [],
    subjek: null,
    inReplyTo: null,
    references: null,
    ...p,
  };
}

// ── Penguraian alamat ────────────────────────────────────────────────────────

test("alamat diambil dari bentuk berkurung maupun telanjang", () => {
  assert.equal(alamatDari('"Budi Santoso" <budi@contoh.id>'), "budi@contoh.id");
  assert.equal(alamatDari("budi@contoh.id"), "budi@contoh.id");
  assert.equal(alamatDari("BUDI@Contoh.ID"), "budi@contoh.id");
  assert.equal(alamatDari("bukan alamat"), null);
});

test("nama tampilan yang berisi alamat tidak dianggap nama", () => {
  // Sebagian klien menaruh alamatnya sendiri sebagai nama tampilan.
  // Menyimpannya membuat kolom nama perusahaan berisi alamat email.
  assert.equal(namaDari('"Budi Santoso" <budi@contoh.id>'), "Budi Santoso");
  assert.equal(namaDari("<budi@contoh.id>"), null);
  assert.equal(namaDari("budi@contoh.id <budi@contoh.id>"), null);
});

test("alamat mesin dikenali dari bagian lokalnya", () => {
  for (const a of [
    "no-reply@x.id",
    "noreply@x.id",
    "donotreply@x.id",
    "mailer-daemon@x.id",
    "postmaster@x.id",
    "notifications@x.id",
  ]) {
    assert.ok(alamatOtomatis(a), a);
  }
  assert.equal(alamatOtomatis("budi@x.id"), false);
  // Kata yang kebetulan mengandung "alert" di tengah bukan alamat mesin.
  assert.equal(alamatOtomatis("ralerte@x.id"), false);
});

test("kiriman massal dikenali dari headernya, bukan dari isinya", () => {
  assert.ok(kirimanMassal(pesan({ dari: "a@x.id", listUnsubscribe: "<https://x.id/u>" })));
  assert.ok(kirimanMassal(pesan({ dari: "a@x.id", precedence: "bulk" })));
  assert.ok(kirimanMassal(pesan({ dari: "a@x.id", autoSubmitted: "auto-replied" })));
  assert.equal(kirimanMassal(pesan({ dari: "a@x.id", autoSubmitted: "no" })), false);
  assert.equal(kirimanMassal(pesan({ dari: "a@x.id" })), false);
});

// ── Aturan dua arah ──────────────────────────────────────────────────────────

test("korespondensi dua arah menjadi kontak", () => {
  const hasil = analisis(
    [
      pesan({ dari: `"Budi" <budi@klien.id>`, kepada: [KITA] }),
      pesan({ dari: KITA, kepada: ["budi@klien.id"] }),
    ],
    OPSI,
  );

  assert.equal(hasil.kontak.length, 1);
  assert.equal(hasil.kontak[0].email, "budi@klien.id");
  assert.equal(hasil.kontak[0].nama, "Budi");
});

test("satu arah TIDAK menjadi kontak, berapa pun banyaknya", () => {
  // Ini inti aturannya. Kotak masuk penuh alamat yang mengirim tanpa pernah
  // dibalas — pendaftaran layanan, buletin, notifikasi. Mengirimi mereka
  // kampanye adalah persis email tanpa dasar izin.
  const hasil = analisis(
    [
      pesan({ dari: "info@buletin.id", kepada: [KITA] }),
      pesan({ dari: "info@buletin.id", kepada: [KITA] }),
      pesan({ dari: "info@buletin.id", kepada: [KITA] }),
    ],
    OPSI,
  );

  assert.equal(hasil.kontak.length, 0);
  assert.equal(hasil.ditolak.satu_arah, 1);
});

test("kita mengirim tanpa pernah dibalas juga bukan dasar izin", () => {
  const hasil = analisis([pesan({ dari: KITA, kepada: ["calon@klien.id"] })], OPSI);
  assert.equal(hasil.kontak.length, 0);
});

test("rekan satu domain dikeluarkan", () => {
  // Tanpa ini, impor pertama memasukkan seluruh rekan sekantor sebagai kontak
  // pemasaran — dan yang pertama menerima kampanye perkenalan adalah orang di
  // meja sebelah.
  const hasil = analisis(
    [
      pesan({ dari: `"Rekan" <rekan@perusahaan.co.id>`, kepada: [KITA] }),
      pesan({ dari: KITA, kepada: ["rekan@perusahaan.co.id"] }),
    ],
    OPSI,
  );

  assert.equal(hasil.kontak.length, 0);
  assert.equal(hasil.ditolak.internal, 1);
});

test("domain internal tambahan ikut dikeluarkan", () => {
  const hasil = analisis(
    [
      pesan({ dari: "orang@grup-kami.id", kepada: [KITA] }),
      pesan({ dari: KITA, kepada: ["orang@grup-kami.id"] }),
    ],
    { alamatSendiri: KITA, domainInternal: ["grup-kami.id"] },
  );
  assert.equal(hasil.kontak.length, 0);
});

test("buletin yang pernah dibalas tetap buletin", () => {
  // Kiriman massal dibuang SEBELUM dihitung sebagai "pernah masuk", jadi
  // membalasnya sekali tidak mengubahnya menjadi prospek.
  const hasil = analisis(
    [
      pesan({ dari: "kabar@media.id", kepada: [KITA], listUnsubscribe: "<https://media.id/u>" }),
      pesan({ dari: KITA, kepada: ["kabar@media.id"] }),
    ],
    OPSI,
  );

  assert.equal(hasil.kontak.length, 0);
  assert.equal(hasil.ditolak.kiriman_massal, 1);
});

test("alamat mesin yang pernah dibalas tetap ditolak", () => {
  const hasil = analisis(
    [
      pesan({ dari: "no-reply@layanan.id", kepada: [KITA] }),
      pesan({ dari: KITA, kepada: ["no-reply@layanan.id"] }),
    ],
    OPSI,
  );
  assert.equal(hasil.kontak.length, 0);
  assert.equal(hasil.ditolak.otomatis, 1);
});

test("balasan ke alamat di Cc ikut terhitung dua arah", () => {
  const hasil = analisis(
    [
      pesan({ dari: "budi@klien.id", kepada: [KITA] }),
      pesan({ dari: KITA, kepada: ["lain@klien.id", "budi@klien.id"] }),
    ],
    OPSI,
  );
  assert.equal(hasil.kontak.length, 1);
});

test("korespondensi terakhir dan jumlah pesan tercatat", () => {
  const hasil = analisis(
    [
      pesan({ dari: "budi@klien.id", kepada: [KITA], waktu: 1000 }),
      pesan({ dari: "budi@klien.id", kepada: [KITA], waktu: 5000 }),
      pesan({ dari: KITA, kepada: ["budi@klien.id"] }),
    ],
    OPSI,
  );
  assert.equal(hasil.kontak[0].terakhir, 5000);
  assert.equal(hasil.kontak[0].jumlahPesan, 2);
});

test("kontak diurutkan dari korespondensi terbaru", () => {
  const hasil = analisis(
    [
      pesan({ dari: "lama@klien.id", kepada: [KITA], waktu: 1000 }),
      pesan({ dari: "baru@klien.id", kepada: [KITA], waktu: 9000 }),
      pesan({ dari: KITA, kepada: ["lama@klien.id", "baru@klien.id"] }),
    ],
    OPSI,
  );
  assert.deepEqual(
    hasil.kontak.map((k) => k.email),
    ["baru@klien.id", "lama@klien.id"],
  );
});

// ── Deteksi balasan ──────────────────────────────────────────────────────────

test("pesan dengan In-Reply-To dikenali sebagai balasan", () => {
  const hasil = analisis(
    [
      pesan({
        dari: "budi@klien.id",
        kepada: [KITA],
        inReplyTo: "<0100018abc@eu-west-1.amazonses.com>",
        subjek: "Re: Penawaran",
      }),
    ],
    OPSI,
  );

  assert.equal(hasil.balasan.length, 1);
  assert.equal(hasil.balasan[0].email, "budi@klien.id");
  // Kurung sudutnya dibuang: nilai ini dicocokkan dengan
  // `campaign_recipients.message_id`, dan kurung yang tertinggal membuatnya
  // tidak pernah cocok dengan apa pun.
  assert.equal(hasil.balasan[0].inReplyTo, "0100018abc@eu-west-1.amazonses.com");
});

test("subjek berawalan Re: cukup meski header rujukannya hilang", () => {
  // Sebagian klien surel tidak mengisi In-Reply-To. Tanpa cadangan ini,
  // balasan mereka tidak pernah tercatat — dan balasan adalah sinyal
  // ketertarikan terkuat yang ada.
  for (const s of ["Re: Penawaran", "RE: Penawaran", "Bls: Penawaran", "balasan: apa pun"]) {
    const hasil = analisis([pesan({ dari: "budi@klien.id", kepada: [KITA], subjek: s })], OPSI);
    assert.equal(hasil.balasan.length, 1, s);
  }
});

test("References dipakai bila In-Reply-To kosong, diambil yang terakhir", () => {
  const hasil = analisis(
    [
      pesan({
        dari: "budi@klien.id",
        kepada: [KITA],
        references: "<awal@x> <tengah@x> <terakhir@x>",
      }),
    ],
    OPSI,
  );
  assert.equal(hasil.balasan[0].inReplyTo, "terakhir@x");
});

test("pesan baru yang bukan balasan tidak tercatat sebagai balasan", () => {
  const hasil = analisis(
    [pesan({ dari: "budi@klien.id", kepada: [KITA], subjek: "Permintaan penawaran" })],
    OPSI,
  );
  assert.equal(hasil.balasan.length, 0);
});

test("balasan dari alamat mesin tidak dicatat", () => {
  const hasil = analisis(
    [pesan({ dari: "mailer-daemon@x.id", kepada: [KITA], subjek: "Re: Penawaran" })],
    OPSI,
  );
  assert.equal(hasil.balasan.length, 0);
});

test("balasan otomatis di luar kantor tidak dicatat sebagai balasan", () => {
  // Berbeda dengan keputusan pada jalur SES, di mana balasan otomatis memang
  // dibiarkan tercatat karena tidak ada headernya. Di sini headernya ADA, jadi
  // menebak-nebak tidak diperlukan.
  const hasil = analisis(
    [
      pesan({
        dari: "budi@klien.id",
        kepada: [KITA],
        subjek: "Re: Penawaran",
        autoSubmitted: "auto-replied",
      }),
    ],
    OPSI,
  );
  assert.equal(hasil.balasan.length, 0);
});

test("pesan tanpa alamat pengirim yang sah dihitung terpisah", () => {
  const hasil = analisis([pesan({ dari: "(rusak)", kepada: [KITA] })], OPSI);
  assert.equal(hasil.ditolak.tanpa_alamat, 1);
  assert.equal(hasil.kontak.length, 0);
});
