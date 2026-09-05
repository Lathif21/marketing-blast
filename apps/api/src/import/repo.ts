// Penyimpanan hasil impor ke basis data.

import { query, transaction } from "../db.js";
import type { ImportSummary, ValidatedRow } from "./validate.js";

export type ConsentSource =
  | "pelanggan_existing"
  | "formulir_web"
  | "izin_lisan"
  | "pameran"
  | "referral"
  | "alamat_generik_terpublikasi"
  | "lainnya";

export const CONSENT_SOURCES: ConsentSource[] = [
  "pelanggan_existing",
  "formulir_web",
  "izin_lisan",
  "pameran",
  "referral",
  "alamat_generik_terpublikasi",
  "lainnya",
];

export type ConsentStrength = "kuat" | "cukup" | "perlu_ditinjau";

/**
 * Kekuatan izin diturunkan dari sumbernya, bukan diminta terpisah ke pengguna.
 * Menanyakannya sebagai pertanyaan sendiri hanya mengundang jawaban optimistis.
 *
 * Nilai ini tidak memblokir pengiriman — ia memicu peringatan pra-kirim dan
 * menjadi jejak audit (02-model-data.md).
 */
export function consentStrengthOf(source: ConsentSource): ConsentStrength {
  switch (source) {
    case "pelanggan_existing":
    case "formulir_web":
      return "kuat";
    case "izin_lisan":
    case "pameran":
    case "referral":
      return "cukup";
    default:
      return "perlu_ditinjau";
  }
}

/** Alamat yang sudah ada di `contacts`, dipakai menandai duplikat. */
export async function existingAmong(emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const { rows } = await query<{ email: string }>(
    "SELECT email FROM contacts WHERE email = ANY($1::citext[])",
    [emails],
  );
  return new Set(rows.map((r) => r.email.toLowerCase()));
}

export interface CommitInput {
  filename: string;
  rowCount: number;
  consentSource: ConsentSource;
  declaredBy: string;
  summary: ImportSummary;
}

export interface CommitResult {
  batchId: string;
  imported: number;
}

/**
 * Menyimpan batch dan seluruh baris yang lolos dalam satu transaksi. Batch
 * yang tercatat tapi kontaknya gagal separuh akan membuat pembatalan menjadi
 * tidak lengkap, jadi keduanya harus berhasil bersama atau tidak sama sekali.
 */
export async function commit(input: CommitInput): Promise<CommitResult> {
  const keep = input.summary.rows.filter((r): r is ValidatedRow => r.outcome === "diterima");

  return transaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO import_batches
         (filename, row_count, accepted, rejected, quarantined, duplicate,
          consent_source, declared_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        input.filename,
        input.rowCount,
        input.summary.accepted,
        input.summary.rejected,
        input.summary.quarantined,
        input.summary.duplicate,
        input.consentSource,
        input.declaredBy,
      ],
    );
    const batchId = rows[0].id;
    const strength = consentStrengthOf(input.consentSource);

    let imported = 0;
    for (const row of keep) {
      // ON CONFLICT DO NOTHING sebagai jaring terakhir: validasi sudah
      // menyaring duplikat, tapi impor lain bisa menyisipkan alamat yang sama
      // di antara validasi dan commit.
      const res = await client.query(
        `INSERT INTO contacts
           (email, domain, company_name, consent_source, consent_strength,
            consent_date, email_origin, status, reference_contact, address,
            acquisition_note, import_batch_id)
         VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, $8::jsonb, $9, $10, $11)
         -- Sasaran konflik mengikuti keunikan yang berlaku sejak multi-tenant:
         -- (tenant_id, email), bukan email saja. Dibiarkan menyebut email
         -- sendirian, Postgres menolak seluruh INSERT karena tidak ada lagi
         -- indeks unik yang cocok - impor berhenti total, bukan diam-diam
         -- salah. Kolom tenant_id sendiri tidak disebut di daftar kolom:
         -- nilainya terisi DEFAULT dari konteks koneksi.
         ON CONFLICT (tenant_id, email) DO NOTHING`,
        [
          row.email,
          row.domain,
          row.companyName || null,
          input.consentSource,
          strength,
          row.emailOrigin,
          row.status,
          JSON.stringify(row.referenceContact),
          row.address || null,
          row.acquisitionNote || null,
          batchId,
        ],
      );
      imported += res.rowCount ?? 0;
    }

    await client.query("UPDATE import_batches SET accepted = $1 WHERE id = $2", [
      imported,
      batchId,
    ]);

    return { batchId, imported };
  });
}

export const CANCEL_WINDOW_DAYS = 30;

export type CancelResult =
  | { ok: true; deleted: number; keptSuppressed: number }
  | { ok: false; reason: "tidak_ditemukan" | "kedaluwarsa" };

/**
 * Membatalkan batch. Kontak yang alamatnya sudah masuk daftar penekanan TIDAK
 * ikut terhapus — alamat itu tetap tinggal, apa pun yang terjadi pada batch
 * asalnya (02-model-data.md).
 *
 * Karena itu penghapusan dilakukan di sini, bukan lewat ON DELETE CASCADE:
 * database tidak tahu pengecualian ini.
 */
export async function cancel(batchId: string): Promise<CancelResult> {
  return transaction(async (client) => {
    const { rows } = await client.query<{ created_at: Date }>(
      "SELECT created_at FROM import_batches WHERE id = $1",
      [batchId],
    );
    if (rows.length === 0) return { ok: false, reason: "tidak_ditemukan" as const };

    const ageDays = (Date.now() - rows[0].created_at.getTime()) / 86_400_000;
    if (ageDays > CANCEL_WINDOW_DAYS) return { ok: false, reason: "kedaluwarsa" as const };

    const kept = await client.query(
      `SELECT count(*)::int AS n
         FROM contacts c
        WHERE c.import_batch_id = $1
          AND EXISTS (SELECT 1 FROM suppression s WHERE s.email = c.email)`,
      [batchId],
    );

    const deleted = await client.query(
      `DELETE FROM contacts c
        WHERE c.import_batch_id = $1
          AND NOT EXISTS (SELECT 1 FROM suppression s WHERE s.email = c.email)`,
      [batchId],
    );

    // Sisa kontak (yang tersuppress) kehilangan tautan batch lewat
    // ON DELETE SET NULL. Itu disengaja: batch-nya memang sudah tidak ada.
    await client.query("DELETE FROM import_batches WHERE id = $1", [batchId]);

    return {
      ok: true as const,
      deleted: deleted.rowCount ?? 0,
      keptSuppressed: kept.rows[0]?.n ?? 0,
    };
  });
}
