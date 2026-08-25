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

/**
 * Menekan alamat berdasarkan pengenal yang dibawa token berhenti berlangganan.
 *
 * Pengenal itu dicari di dua tempat:
 *
 *   1. `contacts.id` — token dari jalur lain yang memegang id kontak
 *   2. `campaign_recipients.id` — jalur pengiriman; inilah yang dipakai
 *      seluruh pesan keluar, karena id baris penerima bertahan meski
 *      kontaknya dihapus
 *
 * Sebelumnya hanya nomor 1 yang dicari, dan itu lubang kepatuhan yang serius:
 * membatalkan batch impor menghapus kontak (`ON DELETE SET NULL` pada
 * `campaign_recipients.contact_id`) sementara baris penerimanya tetap `queued`
 * dan tetap dikirimi. Penerima yang lalu mengklik "berhenti berlangganan"
 * mendapat halaman BERHASIL, padahal tidak ada satu baris pun ditulis ke
 * daftar penekanan — dan kampanye berikutnya tetap sampai kepadanya.
 *
 * Daftar penekanan dikunci pada email, bukan pada kontak, justru supaya
 * catatannya bertahan lebih lama daripada kontaknya. Jalur tulis ini harus
 * mengikuti kunci itu.
 */
export async function suppressByUnsubscribeId(
  id: string,
  reason: SuppressionReason,
): Promise<{ email: string } | null> {
  return transaction(async (client) => {
    const { rows } = await client.query<{ email: string }>(
      `SELECT email::text AS email FROM contacts WHERE id = $1
       UNION ALL
       SELECT email::text FROM campaign_recipients WHERE id = $1
       LIMIT 1`,
      [id],
    );
    if (rows.length === 0) return null;

    const email = rows[0].email;
    await suppress(client, email, reason);
    // Diblokir berdasarkan alamat, bukan berdasarkan id: kontak dengan alamat
    // yang sama bisa saja sudah diimpor ulang di bawah id yang berbeda.
    await client.query("UPDATE contacts SET status = 'diblokir' WHERE email = $1", [email]);
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
