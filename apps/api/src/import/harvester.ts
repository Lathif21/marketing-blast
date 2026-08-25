// Deteksi dan pemetaan keluaran Contact Harvester.
//
// Alat internal menghasilkan CSV dengan 13 kolom tetap. Bila susunan kolom
// cocok, langkah pemetaan dilewati sepenuhnya dan pengguna hanya diminta
// mengonfirmasi — memetakan kolom yang sudah kita kenal namanya hanya
// menambah tempat untuk salah.

/** 13 kolom tetap, sesuai 02-model-data.md. */
export const HARVESTER_COLUMNS = [
  "company",
  "email",
  "whatsapp",
  "website",
  "email_source",
  "phone",
  "other_emails",
  "other_whatsapp",
  "address",
  "page_type",
  "render_mode",
  "search_query",
  "status",
] as const;

/**
 * Cocok bila seluruh 13 kolom hadir, terlepas dari urutan. Menuntut urutan
 * yang sama akan membuat deteksi gagal hanya karena kolom digeser di
 * spreadsheet, dan pengguna tidak akan tahu kenapa.
 */
export function isHarvesterFile(header: string[]): boolean {
  const normalized = new Set(header.map((h) => h.trim().toLowerCase()));
  return HARVESTER_COLUMNS.every((c) => normalized.has(c));
}

/** Pemetaan otomatis kolom sumber ke field kontak. */
export const HARVESTER_MAPPING: Record<string, string> = {
  company: "company_name",
  email: "email",
  email_source: "email_origin",
  website: "domain",
  address: "address",
  search_query: "acquisition_note",
  whatsapp: "reference_contact.whatsapp",
  other_whatsapp: "reference_contact.other_whatsapp",
  phone: "reference_contact.phone",
  other_emails: "(baris karantina terpisah)",
  status: "(baris ditolak bila bukan ok)",
  page_type: "(tidak diimpor)",
  render_mode: "(tidak diimpor)",
};

/** Mengambil host dari URL situs, untuk kolom `domain`. */
export function hostFromWebsite(website: string): string {
  const raw = website.trim();
  if (!raw) return "";
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

export function domainFromEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

/** `other_emails` dipisah `; ` dan tiap alamat jadi baris karantina terpisah. */
export function splitOtherEmails(value: string): string[] {
  return value
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}
