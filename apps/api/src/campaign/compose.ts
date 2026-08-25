// Penyusun pesan.
//
// Identitas pengirim dan tautan berhenti berlangganan disisipkan DI SINI —
// bukan di editor, bukan di driver. Pengguna tidak dapat menghapusnya karena
// tidak pernah memegangnya, dan mengganti driver tidak melewatinya
// (04-aturan-kepatuhan.md §1).
//
// Personalisasi memakai penanda ganda kurung kurawal: {{nama_perusahaan}}.
// Penanda yang tidak dikenali dibiarkan apa adanya, bukan dikosongkan —
// pesan yang memuat "{{nama_pic}}" secara harfiah memang memalukan, tapi
// masih lebih baik daripada kalimat yang kehilangan kata tanpa disadari.

import { config } from "../config.js";
import { unsubscribeUrl } from "../lib/tokens.js";

export interface Personalisasi {
  nama_perusahaan?: string | null;
  email?: string | null;
  [key: string]: string | null | undefined;
}

const PENANDA = /\{\{\s*([a-z_]+)\s*\}\}/gi;

export function terapkanPersonalisasi(template: string, data: Personalisasi): string {
  return template.replace(PENANDA, (utuh, kunci: string) => {
    const nama = kunci.toLowerCase();
    // `Object.hasOwn` menutup penanda seperti {{constructor}} yang jika tidak
    // akan mengembalikan isi Object.prototype ke dalam pesan.
    if (!Object.hasOwn(data, nama)) return utuh;
    const nilai = data[nama];
    return nilai == null || nilai === "" ? utuh : String(nilai);
  });
}

/**
 * Membersihkan nilai yang akan menjadi HEADER pesan.
 *
 * Baris subjek berasal dari template kampanye yang sudah disisipi data kontak,
 * dan data kontak bukan masukan yang dapat dipercaya: `company_name` datang
 * dari CSV impor atau hasil pengumpulan otomatis dari situs pihak ketiga.
 * Parser CSV sengaja mempertahankan baris baru di dalam field berkutip, dan
 * validasi impor hanya memangkas ujungnya — jadi CR/LF di tengah nama
 * perusahaan bertahan utuh sampai ke sini.
 *
 * Tanpa pembersihan ini, satu baris CSV berisi
 *   "Acme Corp\r\nBcc: penyerang@contoh.id"
 * menambahkan header ke pesan yang dikirim dari domain terverifikasi kita.
 * Dan `\r\n\r\n` menutup blok header lebih awal, sehingga
 * `List-Unsubscribe` beserta `List-Unsubscribe-Post` terdorong ke dalam badan
 * pesan — mematikan berhenti berlangganan satu klik untuk penerima itu, yaitu
 * justru jaminan yang berkas ini klaim tegakkan.
 *
 * Dibersihkan DI SINI, bukan di driver. Modul ini adalah batas yang menyatakan
 * bahwa mengganti driver tidak dapat melewati aturan; kalau pembersihannya
 * diserahkan ke driver, klaim itu tidak lagi benar.
 */
export function bersihkanHeader(nilai: string): string {
  return (
    nilai
      // CR, LF, dan NUL — pemisah header dan pemotong string di sisi MTA.
      .replace(/[\r\n\u0000]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      // RFC 5322 membatasi satu baris header pada 998 oktet. Dipotong di sini
      // supaya bukan MTA yang memutuskan cara memotongnya.
      .slice(0, 900)
  );
}

/** Penanda yang dipakai template tapi tidak tersedia di data kontak. */
export function penandaTidakTerisi(template: string, data: Personalisasi): string[] {
  const hilang = new Set<string>();
  for (const m of template.matchAll(PENANDA)) {
    const kunci = m[1].toLowerCase();
    const nilai = data[kunci];
    if (nilai == null || nilai === "") hilang.add(kunci);
  }
  return [...hilang];
}

function footerTeks(contactId: string): string {
  const url = unsubscribeUrl(contactId);
  return [
    "",
    "—",
    config.sender.name,
    config.sender.postalAddress,
    "",
    `Berhenti menerima email ini: ${url}`,
  ].join("\n");
}

function footerHtml(contactId: string): string {
  const url = unsubscribeUrl(contactId);
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    `<hr style="margin:32px 0 16px;border:none;border-top:1px solid #d7dde3">`,
    `<div style="font:13px/1.6 -apple-system,Segoe UI,sans-serif;color:#5e7580">`,
    `<div>${esc(config.sender.name)}</div>`,
    `<div>${esc(config.sender.postalAddress)}</div>`,
    `<div style="margin-top:8px">`,
    `<a href="${esc(url)}" style="color:#5e7580">Berhenti menerima email ini</a>`,
    `</div></div>`,
  ].join("");
}

export interface HasilSusun {
  subject: string;
  textBody: string;
  htmlBody?: string;
}

/**
 * Menyusun pesan lengkap untuk satu penerima.
 *
 * Footer selalu ditambahkan. Tidak ada parameter untuk mematikannya, dan itu
 * disengaja: opsi yang tidak ada tidak bisa keliru diaktifkan.
 */
export function susunPesan(args: {
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  data: Personalisasi;
  contactId: string;
}): HasilSusun {
  const { subject, bodyText, bodyHtml, data, contactId } = args;

  return {
    // Subjek menjadi satu baris header, jadi dibersihkan. Badan pesan tidak —
    // baris baru di sana memang sah.
    subject: bersihkanHeader(terapkanPersonalisasi(subject, data)),
    textBody: terapkanPersonalisasi(bodyText, data) + footerTeks(contactId),
    htmlBody: bodyHtml
      ? terapkanPersonalisasi(bodyHtml, data) + footerHtml(contactId)
      : undefined,
  };
}
