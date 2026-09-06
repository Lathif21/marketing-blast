// Akses tabel `campaigns` dan `campaign_recipients`.

import type { PoolClient } from "pg";
import { query, transaction } from "../db.js";
import { kondisiSegmen } from "./segment.js";
import { hitungAudiens } from "./preflight.js";
import { filterEfektif, JEDA_BAWAAN_JAM, type Pemicu } from "./followup.js";

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
  /** Terisi bila kampanye ini adalah tindak lanjut dari kampanye lain. */
  parent_campaign_id: string | null;
  pemicu: Pemicu | null;
  jeda_lanjutan_jam: number;
  lanjutan_aktif: boolean;
}

export async function create(input: {
  name: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  senderDomain: string;
  segmentFilter?: Record<string, unknown>;
  /** Diisi hanya untuk kampanye tindak lanjut. Keduanya ada atau tidak sama sekali. */
  parentCampaignId?: string | null;
  pemicu?: Pemicu | null;
  jedaLanjutanJam?: number;
  lanjutanAktif?: boolean;
}): Promise<Campaign> {
  const induk = input.parentCampaignId ?? null;
  const pemicu = induk ? (input.pemicu ?? null) : null;

  const { rows } = await query<Campaign>(
    `INSERT INTO campaigns (name, subject, body_text, body_html, sender_domain,
                            segment_filter, parent_campaign_id, pemicu,
                            jeda_lanjutan_jam, lanjutan_aktif)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::pemicu_lanjutan, $9, $10)
     RETURNING *`,
    [
      input.name,
      input.subject,
      input.bodyText,
      input.bodyHtml ?? null,
      input.senderDomain,
      JSON.stringify(input.segmentFilter ?? {}),
      induk,
      pemicu,
      input.jedaLanjutanJam ?? JEDA_BAWAAN_JAM,
      // Pendaftaran bergulir hanya berarti untuk kampanye yang punya induk.
      induk ? (input.lanjutanAktif ?? true) : false,
    ],
  );
  return rows[0];
}

export async function get(id: string): Promise<Campaign | null> {
  const { rows } = await query<Campaign>("SELECT * FROM campaigns WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function list(page: number, perPage: number) {
  const offset = (page - 1) * perPage;
  const { rows } = await query<Campaign & { total: string }>(
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
  const { rows } = await query<Campaign>(
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
      parent_campaign_id: string | null;
      pemicu: Pemicu | null;
      jeda_lanjutan_jam: number;
    }>(
      `SELECT segment_filter, status, parent_campaign_id, pemicu, jeda_lanjutan_jam
         FROM campaigns WHERE id = $1 FOR UPDATE`,
      [campaignId],
    );

    if (crows.length === 0) throw new Error("kampanye tidak ditemukan");
    if (crows[0].status === "selesai" || crows[0].status === "dibatalkan") {
      throw new Error(`kampanye berstatus ${crows[0].status}, tidak dapat diantrekan`);
    }

    // Kriteria tindak lanjut ikut lewat `filterEfektif`, bukan disusun di sini
    // — pra-kirim memakai fungsi yang sama, jadi keduanya tidak dapat berbeda.
    const filter = filterEfektif(crows[0]);
    // $1 sudah dipakai campaignId, jadi penomoran segmen mulai dari sana.
    const segmen = kondisiSegmen(filter, 1);
    const kondisi = ["s.email IS NULL", "c.status = 'aktif'", ...segmen.kondisi];
    const params: unknown[] = [campaignId, ...segmen.params];

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
  const { rows } = await query<Campaign>(
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
  const { rows } = await query<Record<string, string>>(
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

// ── Tindak lanjut ────────────────────────────────────────────────────────────

/** Kampanye tindak lanjut milik satu induk, terbaru lebih dulu. */
export async function daftarLanjutan(parentId: string): Promise<Campaign[]> {
  const { rows } = await query<Campaign>(
    `SELECT * FROM campaigns WHERE parent_campaign_id = $1 ORDER BY created_at DESC`,
    [parentId],
  );
  return rows;
}

/**
 * Kampanye tindak lanjut yang masih mendaftarkan penerima baru.
 *
 * `selesai` dan `dibatalkan` dikecualikan; sisanya ikut, termasuk `draf`.
 * Draf sengaja ikut supaya antreannya sudah terisi saat pengguna membukanya —
 * `susunAntrean` yang menaikkannya ke `terjadwal`, dan itu terjadi hanya kalau
 * memang ada yang bereaksi.
 *
 * `jeda` juga dikecualikan, dan itu bukan sekadar penghematan: `susunAntrean`
 * menaikkan kampanye berstatus `jeda` menjadi `terjadwal`. Kalau kampanye jeda
 * ikut terambil di sini, pekerjaan ini akan menyalakan kembali kampanye yang
 * baru saja dihentikan orang — beberapa menit kemudian, tanpa ada yang
 * menyentuh tombol apa pun.
 */
export async function lanjutanBergulir(): Promise<Campaign[]> {
  const { rows } = await query<Campaign>(
    `SELECT * FROM campaigns
      WHERE lanjutan_aktif
        AND parent_campaign_id IS NOT NULL
        AND status NOT IN ('selesai', 'dibatalkan', 'jeda')
      ORDER BY created_at`,
  );
  return rows;
}

/**
 * Menghentikan atau menyalakan pendaftaran bergulir.
 *
 * Perlu dapat dimatikan tanpa membatalkan kampanyenya: menghentikan
 * pendaftaran orang baru berbeda dari membatalkan pesan yang sudah antre untuk
 * orang yang terlanjur bereaksi.
 */
export async function ubahLanjutanAktif(id: string, aktif: boolean): Promise<Campaign | null> {
  const { rows } = await query<Campaign>(
    `UPDATE campaigns SET lanjutan_aktif = $2, updated_at = now()
      WHERE id = $1 AND parent_campaign_id IS NOT NULL
      RETURNING *`,
    [id, aktif],
  );
  return rows[0] ?? null;
}

export type JenisEvent = "delivery" | "open" | "click";

/**
 * Mencatat event keterlibatan dari SES.
 *
 * Event datang tidak berurutan — klik bisa sampai sebelum buka, dan buka bisa
 * terulang berkali-kali untuk pesan yang sama. Karena itu:
 *
 *   * stempel waktu memakai `COALESCE`, jadi yang tersimpan adalah kejadian
 *     PERTAMA. Buka kedua tidak menggeser "kapan dibuka" menjadi kemarin.
 *   * `status` hanya boleh maju. Tanpa itu, notifikasi delivery yang telat
 *     sampai akan menurunkan penerima yang sudah `clicked` kembali menjadi
 *     `delivered`, dan angka funnel ikut mundur.
 *   * keadaan akhir yang buruk — memantul, keluhan, gagal — tidak pernah
 *     tertimpa. Pesan yang sudah dilaporkan sebagai keluhan tidak menjadi
 *     "dibuka" hanya karena pelacak bukanya sempat terpanggil.
 */
export async function catatEvent(messageId: string, jenis: JenisEvent): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE campaign_recipients
        SET delivered_at = CASE WHEN $2 = 'delivery' THEN COALESCE(delivered_at, now())
                                ELSE delivered_at END,
            opened_at    = CASE WHEN $2 = 'open'  THEN COALESCE(opened_at, now())
                                ELSE opened_at END,
            clicked_at   = CASE WHEN $2 = 'click' THEN COALESCE(clicked_at, now())
                                ELSE clicked_at END,
            status = CASE
              WHEN status IN ('bounced', 'complained', 'failed', 'skipped') THEN status
              WHEN $2 = 'click' THEN 'clicked'
              WHEN $2 = 'open'  AND status <> 'clicked' THEN 'opened'
              WHEN $2 = 'delivery' AND status NOT IN ('opened', 'clicked') THEN 'delivered'
              ELSE status
            END
      WHERE message_id = $1`,
    [messageId, jenis],
  );
  return (rowCount ?? 0) > 0;
}

export interface Balasan {
  /** `Message-ID` pesan yang dibalas, bila klien email menyertakannya. */
  messageId?: string | null;
  /** Alamat pembalas. Dipakai bila `messageId` tidak dapat ditelusuri. */
  email?: string | null;
  /**
   * Batasi pencarian pada satu kampanye. Diisi jalur manual, yang selalu tahu
   * kampanye mana yang sedang ditinjau; dibiarkan kosong jalur surat masuk,
   * yang hanya tahu alamat pengirimnya.
   */
  campaignId?: string | null;
  cuplikan?: string | null;
}

/** Panjang cuplikan balasan yang disimpan. Lihat catatan di migrasi 009. */
const MAKS_CUPLIKAN = 280;

/**
 * Mencatat bahwa seseorang membalas.
 *
 * Dicocokkan lewat dua jalan, berurutan. `Message-ID` lebih dipercaya karena
 * menunjuk tepat ke satu pengiriman; alamat pengirim hanya menunjuk ke orang,
 * dan orang yang sama bisa menerima beberapa kampanye. Saat hanya alamat yang
 * tersedia, yang dipilih adalah pengiriman terakhir kepadanya — tebakan
 * terbaik yang tersedia, dan tebakan yang salah di sini hanya berarti balasan
 * tercatat pada kampanye yang keliru, bukan pesan terkirim ke orang yang
 * keliru.
 */
export async function catatBalasan(
  b: Balasan,
): Promise<{ recipient_id: string; campaign_id: string; baru: boolean } | null> {
  const cuplikan = b.cuplikan?.trim().slice(0, MAKS_CUPLIKAN) || null;

  const { rows } = await query<{ recipient_id: string; campaign_id: string; baru: boolean }>(
    `WITH sasaran AS (
       SELECT id, replied_at AS sudah FROM campaign_recipients
        -- Header Message-ID berbentuk <id@region.amazonses.com> sementara yang
        -- tersimpan hanyalah id-nya. Bagian sebelum @ dicocokkan juga supaya
        -- balasan yang membawa header lengkap tetap tertaut.
        WHERE (
                ($1::text IS NOT NULL
                 AND (message_id = $1 OR message_id = split_part($1, '@', 1)))
                OR
                ($1::text IS NULL AND $2::citext IS NOT NULL
                 AND email = $2 AND sent_at IS NOT NULL)
              )
          -- Kurung di atas wajib: tanpa itu AND mengikat lebih kuat daripada
          -- OR, dan pembatasan kampanye hanya berlaku pada cabang kedua.
          AND ($4::uuid IS NULL OR campaign_id = $4)
        ORDER BY sent_at DESC NULLS LAST
        LIMIT 1
     )
     UPDATE campaign_recipients r
        SET replied_at = COALESCE(r.replied_at, now()),
            reply_snippet = COALESCE(r.reply_snippet, $3)
       FROM sasaran
      WHERE r.id = sasaran.id
     -- Kolom baru membedakan "balasan ini baru saja tercatat" dari "balasannya
     -- memang sudah tercatat sejak dulu". Bedanya penting bagi sinkronisasi
     -- Gmail: jendela after: di Gmail hanya berketelitian hari, jadi pesan
     -- yang sama terbaca lagi pada putaran berikutnya — dan penghitung
     -- "balasan tercatat" akan naik terus tanpa satu pun balasan baru.
     RETURNING r.id AS recipient_id, r.campaign_id, (sasaran.sudah IS NULL) AS baru`,
    [b.messageId ?? null, b.email ?? null, cuplikan, b.campaignId ?? null],
  );

  return rows[0] ?? null;
}

export interface RingkasanTindakLanjut {
  terkirim: number;
  membalas: number;
  diklik: number;
  dibuka: number;
  /** Bereaksi dengan cara apa pun. Bukan penjumlahan tiga angka di atas —
   *  satu orang bisa membuka lalu mengklik lalu membalas. */
  bereaksi: number;
  menolak: number;
  diam: number;
  menunggu: number;
}

/**
 * Komposisi reaksi atas satu kampanye.
 *
 * Menjawab pertanyaan yang muncul setelah kampanye perkenalan terkirim:
 * berapa yang layak ditindaklanjuti, dan berapa yang sudah boleh dihiraukan.
 *
 * Dihitung dari `campaign_recipients`, bukan dari `contacts.respons`. Yang
 * ditanyakan di layar kampanye adalah reaksi atas KAMPANYE INI; `contacts`
 * menyimpan penilaian lintas-kampanye, dan memakainya di sini akan menghitung
 * orang yang tertarik pada kampanye lain sebagai keberhasilan kampanye ini.
 */
export async function ringkasanTindakLanjut(
  campaignId: string,
  jendelaHari: number,
): Promise<RingkasanTindakLanjut> {
  const { rows } = await query<Record<string, string>>(
    `SELECT
       count(*) FILTER (WHERE sent_at IS NOT NULL)::text      AS terkirim,
       count(*) FILTER (WHERE replied_at IS NOT NULL)::text   AS membalas,
       count(*) FILTER (WHERE clicked_at IS NOT NULL)::text   AS diklik,
       count(*) FILTER (WHERE opened_at IS NOT NULL)::text    AS dibuka,
       count(*) FILTER (WHERE opened_at IS NOT NULL
                           OR clicked_at IS NOT NULL
                           OR replied_at IS NOT NULL)::text   AS bereaksi,
       count(*) FILTER (WHERE complained_at IS NOT NULL
                           OR EXISTS (SELECT 1 FROM suppression s
                                       WHERE s.email = campaign_recipients.email))::text AS menolak,
       count(*) FILTER (WHERE sent_at IS NOT NULL
                          AND opened_at IS NULL AND clicked_at IS NULL AND replied_at IS NULL
                          AND sent_at <= now() - make_interval(days => $2))::text AS diam,
       count(*) FILTER (WHERE sent_at IS NOT NULL
                          AND opened_at IS NULL AND clicked_at IS NULL AND replied_at IS NULL
                          AND sent_at > now() - make_interval(days => $2))::text  AS menunggu
     FROM campaign_recipients WHERE campaign_id = $1`,
    [campaignId, jendelaHari],
  );
  const r = rows[0] ?? {};
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    terkirim: n("terkirim"), membalas: n("membalas"), diklik: n("diklik"),
    dibuka: n("dibuka"), bereaksi: n("bereaksi"), menolak: n("menolak"),
    diam: n("diam"), menunggu: n("menunggu"),
  };
}
