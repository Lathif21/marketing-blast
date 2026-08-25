// Aturan validasi impor.
//
// Fungsi di sini murni — tidak menyentuh basis data — supaya seluruh matriks
// aturan dapat diuji tanpa Postgres. Yang perlu database (duplikat, daftar
// penekanan) disuntikkan sebagai himpunan alamat.

import {
  domainFromEmail,
  hostFromWebsite,
  splitOtherEmails,
} from "./harvester.js";

/**
 * Nasib satu baris. Sengaja TIDAK memuat "karantina": karantina adalah
 * `status` kontak, bukan hasil validasi. Baris `found` dan `guessed` sama-sama
 * `diterima` dan sama-sama disimpan berstatus karantina — yang membedakannya
 * hanya peluang lolos verifikasi nanti.
 *
 * Mencampur keduanya membuat angka ringkasan salah: "diterima" akan selalu
 * nol dan pengguna kehilangan jumlah baris yang benar-benar tersimpan.
 */
export type RowOutcome = "diterima" | "duplikat" | "ditolak";

export type RejectReason =
  | "format_email_tidak_valid"
  | "email_kosong"
  | "ada_di_penekanan"
  | "status_sumber_bukan_ok";

export interface ValidatedRow {
  outcome: RowOutcome;
  reason?: RejectReason;
  email: string;
  domain: string;
  companyName: string;
  emailOrigin: "found" | "guessed" | "manual";
  status: "aktif" | "karantina" | "diblokir";
  referenceContact: Record<string, string>;
  address: string;
  acquisitionNote: string;
  /** Baris turunan dari `other_emails`, selalu karantina. */
  derivedFrom?: string;
}

export interface ImportSummary {
  accepted: number;
  quarantined: number;
  duplicate: number;
  rejected: number;
  rows: ValidatedRow[];
}

/**
 * Validasi alamat sengaja konservatif, bukan RFC 5322 penuh. Regex RFC lengkap
 * menerima bentuk yang tidak pernah muncul di daftar B2B dan tetap tidak
 * membuktikan alamatnya ada. Yang benar-benar menyaring adalah verifikasi
 * alamat di Fase 3.
 */
const EMAIL_RE = /^[^\s@,;]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export function isValidEmail(email: string): boolean {
  const value = email.trim();
  if (value.length === 0 || value.length > 254) return false;
  return EMAIL_RE.test(value);
}

export interface RowInput {
  email: string;
  company?: string;
  website?: string;
  emailSource?: string;
  sourceStatus?: string;
  address?: string;
  searchQuery?: string;
  whatsapp?: string;
  otherWhatsapp?: string;
  phone?: string;
  otherEmails?: string;
}

export interface ValidateContext {
  /** Alamat yang sudah ada di tabel `contacts`. */
  existing: Set<string>;
  /** Alamat yang ada di daftar penekanan. */
  suppressed: Set<string>;
  /** Berkas berasal dari Contact Harvester, jadi `status` dan `email_source` berlaku. */
  fromHarvester: boolean;
}

function normalizeOrigin(value: string | undefined): "found" | "guessed" | "manual" {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "found") return "found";
  if (v === "guessed") return "guessed";
  return "manual";
}

function baseRow(input: RowInput, email: string): ValidatedRow {
  const reference: Record<string, string> = {};
  if (input.whatsapp?.trim()) reference.whatsapp = input.whatsapp.trim();
  if (input.otherWhatsapp?.trim()) reference.other_whatsapp = input.otherWhatsapp.trim();
  if (input.phone?.trim()) reference.phone = input.phone.trim();

  return {
    outcome: "diterima",
    email,
    domain: hostFromWebsite(input.website ?? "") || domainFromEmail(email),
    companyName: (input.company ?? "").trim(),
    emailOrigin: normalizeOrigin(input.emailSource),
    status: "karantina",
    referenceContact: reference,
    address: (input.address ?? "").trim(),
    acquisitionNote: (input.searchQuery ?? "").trim(),
  };
}

/**
 * Menilai satu alamat. `seen` dibagi antar-baris supaya duplikat di dalam
 * berkas yang sama juga tertangkap, bukan hanya duplikat terhadap database.
 */
function judge(
  row: ValidatedRow,
  ctx: ValidateContext,
  seen: Set<string>,
): ValidatedRow {
  const key = row.email.toLowerCase();

  if (!isValidEmail(row.email)) {
    return { ...row, outcome: "ditolak", reason: "format_email_tidak_valid" };
  }
  // Penekanan diperiksa sebelum duplikat: alamat yang sudah ditekan harus
  // ditolak dengan alasan yang benar, dan tidak ada opsi menimpa.
  if (ctx.suppressed.has(key)) {
    return { ...row, outcome: "ditolak", reason: "ada_di_penekanan" };
  }
  if (ctx.existing.has(key) || seen.has(key)) {
    return { ...row, outcome: "duplikat" };
  }

  seen.add(key);

  // Semua kontak baru masuk karantina. `found` pun belum terverifikasi
  // alamatnya — yang membedakannya dari `guessed` adalah peluang lolos
  // verifikasi, bukan boleh-tidaknya langsung dikirimi.
  return { ...row, outcome: "diterima", status: "karantina" };
}

/**
 * Seluruh alamat yang akan dinilai dari sekumpulan baris, TERMASUK turunan
 * dari `other_emails`.
 *
 * Ada sebagai fungsi tersendiri karena pernah salah: langkah validasi dan
 * langkah commit mengumpulkan alamat dengan cara berbeda, dan commit tidak
 * melihat alamat turunan. Akibatnya alamat yang ada di daftar penekanan lolos
 * tersimpan meski validasi sudah menolaknya. Kedua langkah wajib memakai
 * fungsi ini — perbedaan sekecil apa pun di antara keduanya adalah lubang
 * kepatuhan.
 */
export function collectEmails(inputs: RowInput[]): string[] {
  return inputs.flatMap((r) =>
    [r.email, ...splitOtherEmails(r.otherEmails ?? "")].filter(Boolean),
  );
}

export function validateRows(inputs: RowInput[], ctx: ValidateContext): ImportSummary {
  const rows: ValidatedRow[] = [];
  const seen = new Set<string>();

  for (const input of inputs) {
    const email = (input.email ?? "").trim();

    // Baris tanpa alamat ditolak untuk kanal email. Nomor telepon dan
    // WhatsApp-nya tidak menyelamatkan baris ini: kanal WhatsApp berada di
    // luar lingkup (04-aturan-kepatuhan.md).
    if (!email) {
      rows.push({
        ...baseRow(input, ""),
        outcome: "ditolak",
        reason: "email_kosong",
      });
      continue;
    }

    const row = baseRow(input, email);

    // Kolom `status` alat internal: selain `ok` berarti pengumpulannya sendiri
    // bermasalah, jadi barisnya tidak dapat dipercaya.
    if (ctx.fromHarvester) {
      const status = (input.sourceStatus ?? "").trim().toLowerCase();
      if (status && status !== "ok") {
        rows.push({ ...row, outcome: "ditolak", reason: "status_sumber_bukan_ok" });
        continue;
      }
    }

    rows.push(judge(row, ctx, seen));

    // `other_emails` menjadi baris karantina terpisah, selalu `guessed`:
    // alamat tambahan di halaman yang sama tidak punya bukti sekuat alamat
    // utamanya.
    for (const extra of splitOtherEmails(input.otherEmails ?? "")) {
      const derived = { ...baseRow({ ...input, email: extra }, extra) };
      derived.emailOrigin = "guessed";
      derived.derivedFrom = email;
      rows.push(judge(derived, ctx, seen));
    }
  }

  const accepted = rows.filter((r) => r.outcome === "diterima");

  return {
    accepted: accepted.length,
    // Bagian dari yang diterima yang alamatnya hasil tebakan. Angka ini yang
    // perlu dilihat pengguna: dari sekian yang tersimpan, sekian di antaranya
    // paling berisiko memantul.
    quarantined: accepted.filter((r) => r.emailOrigin === "guessed").length,
    duplicate: rows.filter((r) => r.outcome === "duplikat").length,
    rejected: rows.filter((r) => r.outcome === "ditolak").length,
    rows,
  };
}
