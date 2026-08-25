// Akses tabel `suppression`.
//
// Modul ini sengaja tidak punya fungsi hapus. Kalau suatu saat ada yang
// membutuhkannya, yang perlu diperiksa lebih dulu bukan modul ini melainkan
// 04-aturan-kepatuhan.md §2 — dan peran basis data akan menolak lebih dulu
// sekalipun fungsinya ditambahkan.

import type { PoolClient } from "pg";
import { pool, transaction } from "../db.js";

export type { SuppressionReason } from "./ses-events.js";
import type { SuppressionReason } from "./ses-events.js";

export interface SuppressionEntry {
  email: string;
  reason: SuppressionReason;
  campaign_id: string | null;
  created_at: string;
}

/**
 * Menambahkan alamat ke daftar. Idempoten: alamat yang sudah ada dibiarkan
 * dengan alasan aslinya, karena alasan pertama yang mencatat adalah yang
 * paling dekat dengan kejadiannya.
 */
export async function suppress(
  client: PoolClient,
  email: string,
  reason: SuppressionReason,
  campaignId: string | null = null,
): Promise<void> {
  await client.query(
    `INSERT INTO suppression (email, reason, campaign_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING`,
    [email, reason, campaignId],
  );
}

/**
 * Menekan alamat sekaligus memblokir kontaknya dalam satu transaksi.
 * Keduanya harus terjadi bersamaan: alamat yang tertekan tapi kontaknya masih
 * `aktif` akan tetap terpilih saat penyusunan segmen.
 */
export async function suppressByEmail(
  email: string,
  reason: SuppressionReason,
  campaignId: string | null = null,
): Promise<{ contactFound: boolean }> {
  return transaction(async (client) => {
    await suppress(client, email, reason, campaignId);
    const { rowCount } = await client.query(
      `UPDATE contacts SET status = 'diblokir' WHERE email = $1`,
      [email],
    );
    return { contactFound: (rowCount ?? 0) > 0 };
  });
}

/** Dipakai jalur berhenti berlangganan, yang hanya memegang `contact_id`. */
export async function suppressByContactId(
  contactId: string,
  reason: SuppressionReason,
): Promise<{ email: string } | null> {
  return transaction(async (client) => {
    const { rows } = await client.query<{ email: string }>(
      "SELECT email FROM contacts WHERE id = $1",
      [contactId],
    );
    if (rows.length === 0) return null;

    const email = rows[0].email;
    await suppress(client, email, reason);
    await client.query("UPDATE contacts SET status = 'diblokir' WHERE id = $1", [contactId]);
    return { email };
  });
}

export async function isSuppressed(email: string): Promise<boolean> {
  const { rowCount } = await pool.query("SELECT 1 FROM suppression WHERE email = $1", [email]);
  return (rowCount ?? 0) > 0;
}

/** Menyaring daftar alamat, mengembalikan yang ada di daftar penekanan. */
export async function suppressedAmong(emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const { rows } = await pool.query<{ email: string }>(
    "SELECT email FROM suppression WHERE email = ANY($1::citext[])",
    [emails],
  );
  return new Set(rows.map((r) => r.email.toLowerCase()));
}

export async function list(page = 1, perPage = 50) {
  const limit = Math.min(Math.max(perPage, 1), 200);
  const offset = (Math.max(page, 1) - 1) * limit;

  const [items, total] = await Promise.all([
    pool.query<SuppressionEntry>(
      `SELECT email, reason, campaign_id, created_at
         FROM suppression
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    pool.query<{ count: string }>("SELECT count(*)::text AS count FROM suppression"),
  ]);

  return {
    items: items.rows,
    total: Number(total.rows[0].count),
    page: Math.max(page, 1),
    per_page: limit,
  };
}
