// Kuota harian domain pengirim.
//
// Satu-satunya tempat yang menjawab "berapa yang masih boleh dikirim hari
// ini". Pemeriksaan pra-kirim dan worker sama-sama memanggil modul ini —
// kalau keduanya menghitung sendiri-sendiri, cepat atau lambat angkanya
// berbeda dan yang ditegakkan bukan yang ditampilkan.

import type { PoolClient } from "pg";
import { clientKonteks } from "../db.js";
import { batasHarian, tanggalMuat, TAHAP_AWAL, TOTAL_STAGES } from "./warmup.js";

export interface KuotaHarian {
  domain: string;
  stage: number;
  /** `null` pada tahap terakhir: tidak ada batas tetap. */
  batasHarian: number | null;
  terpakaiHariIni: number;
  /** `null` berarti tak terbatas. */
  sisa: number | null;
}

/**
 * Membaca baris kesehatan domain, membuatnya bila belum ada.
 *
 * Domain yang belum pernah tercatat dimulai dari tahap 1, bukan tahap
 * tertinggi. Domain tanpa riwayat adalah domain tanpa reputasi, dan itu
 * kondisi paling rapuh — bukan paling bebas.
 */
export async function ensureDomain(client: PoolClient, domain: string): Promise<void> {
  await client.query(
    `INSERT INTO domain_health (domain, warmup_stage)
     VALUES ($1, $2)
     ON CONFLICT (domain) DO NOTHING`,
    [domain, TAHAP_AWAL],
  );
}

export async function kuotaHariIni(domain: string): Promise<KuotaHarian> {
  const client = await clientKonteks();
  {
    await ensureDomain(client, domain);

    const { rows } = await client.query<{ warmup_stage: number; sent_count: string | null }>(
      `SELECT dh.warmup_stage,
              dds.sent_count
         FROM domain_health dh
         LEFT JOIN domain_daily_sends dds
                ON dds.domain = dh.domain AND dds.send_date = CURRENT_DATE
        WHERE dh.domain = $1`,
      [domain],
    );

    const row = rows[0];
    const stage = row?.warmup_stage ?? TAHAP_AWAL;
    const terpakai = Number(row?.sent_count ?? 0);
    const batas = batasHarian(stage);

    return {
      domain,
      stage,
      batasHarian: batas,
      terpakaiHariIni: terpakai,
      sisa: batas === null ? null : Math.max(batas - terpakai, 0),
    };
  }
}

/**
 * Menambah penghitung dan mengembalikan apakah penambahan masih dalam batas.
 *
 * Dijalankan di dalam transaksi yang sama dengan penandaan penerima sebagai
 * terkirim. Kalau penghitung naik tapi pengiriman gagal dicatat, kuota
 * terbuang; kalau sebaliknya, kuota terlampaui tanpa terdeteksi.
 */
export async function pakaiKuota(
  client: PoolClient,
  domain: string,
  jumlah = 1,
): Promise<boolean> {
  await ensureDomain(client, domain);

  const { rows } = await client.query<{ warmup_stage: number }>(
    "SELECT warmup_stage FROM domain_health WHERE domain = $1 FOR UPDATE",
    [domain],
  );
  const batas = batasHarian(rows[0]?.warmup_stage ?? TAHAP_AWAL);

  const { rows: after } = await client.query<{ sent_count: number }>(
    `INSERT INTO domain_daily_sends (domain, send_date, sent_count)
     VALUES ($1, CURRENT_DATE, $2)
     ON CONFLICT (domain, send_date)
     DO UPDATE SET sent_count = domain_daily_sends.sent_count + EXCLUDED.sent_count
     RETURNING sent_count`,
    [domain, jumlah],
  );

  if (batas === null) return true;
  return after[0].sent_count <= batas;
}

export { TOTAL_STAGES, tanggalMuat };
