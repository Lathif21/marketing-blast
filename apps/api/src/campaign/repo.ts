// Akses tabel `campaigns` dan `campaign_recipients`.

import type { PoolClient } from "pg";
import { pool, transaction } from "../db.js";
import { hitungAudiens } from "./preflight.js";

export type CampaignStatus =
  | "draf" | "terjadwal" | "berjalan" | "jeda" | "selesai" | "dibatalkan";

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  sender_domain: string;
  status: CampaignStatus;
  segment_filter: Record<string, unknown>;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export async function create(input: {
  name: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  senderDomain: string;
  segmentFilter?: Record<string, unknown>;
}): Promise<Campaign> {
  const { rows } = await pool.query<Campaign>(
    `INSERT INTO campaigns (name, subject, body_text, body_html, sender_domain, segment_filter)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.name,
      input.subject,
      input.bodyText,
      input.bodyHtml ?? null,
      input.senderDomain,
      JSON.stringify(input.segmentFilter ?? {}),
    ],
  );
  return rows[0];
}

export async function get(id: string): Promise<Campaign | null> {
  const { rows } = await pool.query<Campaign>("SELECT * FROM campaigns WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function list(page: number, perPage: number) {
  const offset = (page - 1) * perPage;
  const { rows } = await pool.query<Campaign & { total: string }>(
    `SELECT *, count(*) OVER()::text AS total
       FROM campaigns
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2`,
    [perPage, offset],
  );
  const total = rows.length > 0 ? Number(rows[0].total) : 0;
  return { items: rows.map(({ total: _t, ...c }) => c), total, page, per_page: perPage };
}

/** Hanya kampanye yang belum pernah diantrekan yang boleh disunting. */
export async function update(
  id: string,
  patch: Partial<Pick<Campaign, "name" | "subject" | "body_text" | "body_html">> & {
    segment_filter?: Record<string, unknown>;
  },
): Promise<Campaign | null> {
  const set: string[] = [];
  const params: unknown[] = [];

  for (const key of ["name", "subject", "body_text", "body_html"] as const) {
    if (patch[key] !== undefined) {
      params.push(patch[key]);
      set.push(`${key} = $${params.length}`);
    }
  }
  if (patch.segment_filter !== undefined) {
    params.push(JSON.stringify(patch.segment_filter));
    set.push(`segment_filter = $${params.length}`);
  }
  if (set.length === 0) return get(id);

  params.push(id);
  const { rows } = await pool.query<Campaign>(
    `UPDATE campaigns SET ${set.join(", ")}, updated_at = now()
      WHERE id = $${params.length} AND status = 'draf'
      RETURNING *`,
    params,
  );
  return rows[0] ?? null;
}

export interface HasilAntre {
  campaign_id: string;
  diantrekan: number;
  dilewati: number;
}

/**
 * Menyusun antrean penerima.
 *
 * Dua hal yang membuat operasi ini aman diulang:
 *
 * 1. `ON CONFLICT (campaign_id, email) DO NOTHING` — menjalankan ulang setelah
 *    kegagalan separuh jalan tidak menghasilkan pengiriman ganda.
 * 2. Penyaringan tersuppress dan terkarantina terjadi di SQL yang sama dengan
 *    penyisipan, bukan di langkah terpisah. Kontak yang tersuppress satu detik
 *    sebelum antrean disusun tetap tersaring.
 *
 * Penyaringan diulang lagi saat kirim (lihat sender.ts). Jeda antara antrean
 * disusun dan pesan benar-benar keluar bisa berhari-hari, dan seseorang bisa
 * berhenti berlangganan di sela itu.
 */
export async function susunAntrean(campaignId: string): Promise<HasilAntre> {
  return transaction(async (client) => {
    const { rows: crows } = await client.query<{
      segment_filter: Record<string, unknown>;
      status: CampaignStatus;
    }>("SELECT segment_filter, status FROM campaigns WHERE id = $1 FOR UPDATE", [campaignId]);

    if (crows.length === 0) throw new Error("kampanye tidak ditemukan");
    if (crows[0].status === "selesai" || crows[0].status === "dibatalkan") {
      throw new Error(`kampanye berstatus ${crows[0].status}, tidak dapat diantrekan`);
    }

    const filter = crows[0].segment_filter ?? {};
    const kondisi: string[] = ["s.email IS NULL", "c.status = 'aktif'"];
    const params: unknown[] = [campaignId];

    if (typeof filter.consent_source === "string") {
      params.push(filter.consent_source);
      kondisi.push(`c.consent_source = $${params.length}`);
    }
    if (typeof filter.domain === "string") {
      params.push(filter.domain);
      kondisi.push(`c.domain = $${params.length}`);
    }

    const { rowCount } = await client.query(
      `INSERT INTO campaign_recipients (campaign_id, contact_id, email)
       SELECT $1, c.id, c.email
         FROM contacts c
         LEFT JOIN suppression s ON s.email = c.email
        WHERE ${kondisi.join(" AND ")}
       ON CONFLICT (campaign_id, email) DO NOTHING`,
      params,
    );

    const audiens = await hitungAudiens(client, filter);

    await client.query(
      `UPDATE campaigns
          SET status = 'terjadwal', updated_at = now()
        WHERE id = $1 AND status IN ('draf', 'jeda')`,
      [campaignId],
    );

    return {
      campaign_id: campaignId,
      diantrekan: rowCount ?? 0,
      dilewati: audiens.tersuppress + audiens.terkarantina,
    };
  });
}

export async function ubahStatus(id: string, status: CampaignStatus): Promise<Campaign | null> {
  // `$2` dicast eksplisit ke enum di SETIAP pemakaian.
  //
  // Tanpa cast, Postgres menyimpulkan tipe yang bertentangan untuk parameter
  // yang sama — `campaign_status` pada `SET`, `text` pada kedua perbandingan
  // CASE — dan menolak seluruh query dengan SQLSTATE 42P08. Kegagalannya
  // hanya muncul saat dijalankan, tidak terlihat TypeScript.
  const { rows } = await pool.query<Campaign>(
    `UPDATE campaigns
        SET status = $2::campaign_status,
            started_at  = CASE WHEN $2::campaign_status = 'berjalan' AND started_at IS NULL
                               THEN now() ELSE started_at END,
            finished_at = CASE WHEN $2::campaign_status IN ('selesai', 'dibatalkan')
                               THEN now() ELSE finished_at END,
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [id, status],
  );
  return rows[0] ?? null;
}

export interface Funnel {
  queued: number; sent: number; delivered: number; opened: number;
  clicked: number; bounced: number; complained: number;
  failed: number; skipped: number; total: number;
}

export async function funnel(campaignId: string): Promise<Funnel> {
  const { rows } = await pool.query<Record<string, string>>(
    `SELECT
       count(*)::text AS total,
       count(*) FILTER (WHERE status = 'queued')::text     AS queued,
       count(*) FILTER (WHERE sent_at IS NOT NULL)::text   AS sent,
       count(*) FILTER (WHERE delivered_at IS NOT NULL)::text AS delivered,
       count(*) FILTER (WHERE opened_at IS NOT NULL)::text AS opened,
       count(*) FILTER (WHERE clicked_at IS NOT NULL)::text AS clicked,
       count(*) FILTER (WHERE bounced_at IS NOT NULL)::text AS bounced,
       count(*) FILTER (WHERE complained_at IS NOT NULL)::text AS complained,
       count(*) FILTER (WHERE status = 'failed')::text     AS failed,
       count(*) FILTER (WHERE status = 'skipped')::text    AS skipped
     FROM campaign_recipients WHERE campaign_id = $1`,
    [campaignId],
  );
  const r = rows[0];
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    total: n("total"), queued: n("queued"), sent: n("sent"),
    delivered: n("delivered"), opened: n("opened"), clicked: n("clicked"),
    bounced: n("bounced"), complained: n("complained"),
    failed: n("failed"), skipped: n("skipped"),
  };
}

/** Mengambil satu batch penerima yang siap dikirim, mengunci barisnya. */
export async function ambilBatch(
  client: PoolClient,
  campaignId: string,
  limit: number,
): Promise<Array<{ id: string; contact_id: string | null; email: string }>> {
  const { rows } = await client.query<{ id: string; contact_id: string | null; email: string }>(
    `SELECT id, contact_id, email
       FROM campaign_recipients
      WHERE campaign_id = $1 AND status = 'queued'
      ORDER BY queued_at
      LIMIT $2
      FOR UPDATE SKIP LOCKED`,
    [campaignId, limit],
  );
  return rows;
}
