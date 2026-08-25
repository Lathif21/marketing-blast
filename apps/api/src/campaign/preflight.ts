// Pemeriksaan pra-kirim.
//
// Dijalankan di server, bukan di UI. Antarmuka bisa dilewati, endpoint tidak
// (04-aturan-kepatuhan.md). Hasil pemeriksaan yang gagal MEMBLOKIR pengiriman,
// bukan sekadar memberi peringatan — kalau butir yang gagal masih bisa
// dilanjutkan, butir itu bukan aturan melainkan saran.

import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { kuotaHariIni, tanggalMuat } from "../domain/quota.js";
import { penandaTidakTerisi } from "./compose.js";

export type ButirId =
  | "identitas_pengirim"
  | "tautan_berhenti"
  | "penekanan_dikeluarkan"
  | "karantina_dikeluarkan"
  | "penerima_ada"
  | "batas_pemanasan"
  | "penanda_terisi";

export interface Butir {
  butir: ButirId;
  lolos: boolean;
  /** `true` bila kegagalannya tidak memblokir, hanya perlu diketahui. */
  peringatan?: boolean;
  jumlah?: number;
  pesan?: string;
}

export interface HasilPreflight {
  dapat_dikirim: boolean;
  pemeriksaan: Butir[];
  ringkasan: {
    kandidat: number;
    layak_kirim: number;
    tersuppress: number;
    terkarantina: number;
    sisa_kuota: number | null;
    tahap_pemanasan: number;
    tanggal_muat: string | null;
  };
}

interface Hitungan {
  kandidat: number;
  tersuppress: number;
  terkarantina: number;
  layak: number;
}

/**
 * Menghitung komposisi audiens.
 *
 * Kontak tersuppress dan terkarantina dihitung terpisah karena artinya berbeda
 * bagi pengguna: yang pertama tidak akan pernah dikirimi lagi, yang kedua
 * menunggu verifikasi dan bisa aktif nanti.
 */
export async function hitungAudiens(
  client: PoolClient,
  segmentFilter: Record<string, unknown>,
): Promise<Hitungan> {
  const kondisi: string[] = ["1 = 1"];
  const params: unknown[] = [];

  if (typeof segmentFilter.consent_source === "string") {
    params.push(segmentFilter.consent_source);
    kondisi.push(`c.consent_source = $${params.length}`);
  }
  if (typeof segmentFilter.domain === "string") {
    params.push(segmentFilter.domain);
    kondisi.push(`c.domain = $${params.length}`);
  }

  const where = kondisi.join(" AND ");

  const { rows } = await client.query<{
    kandidat: string;
    tersuppress: string;
    terkarantina: string;
    layak: string;
  }>(
    `SELECT
       count(*)::text AS kandidat,
       count(*) FILTER (WHERE s.email IS NOT NULL)::text AS tersuppress,
       count(*) FILTER (WHERE s.email IS NULL AND c.status = 'karantina')::text AS terkarantina,
       count(*) FILTER (WHERE s.email IS NULL AND c.status = 'aktif')::text AS layak
     FROM contacts c
     LEFT JOIN suppression s ON s.email = c.email
     WHERE ${where}`,
    params,
  );

  return {
    kandidat: Number(rows[0].kandidat),
    tersuppress: Number(rows[0].tersuppress),
    terkarantina: Number(rows[0].terkarantina),
    layak: Number(rows[0].layak),
  };
}

export async function preflight(campaignId: string): Promise<HasilPreflight> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{
      subject: string;
      body_text: string;
      sender_domain: string;
      segment_filter: Record<string, unknown>;
    }>(
      `SELECT subject, body_text, sender_domain, segment_filter
         FROM campaigns WHERE id = $1`,
      [campaignId],
    );
    if (rows.length === 0) throw new Error("kampanye tidak ditemukan");
    const c = rows[0];

    const audiens = await hitungAudiens(client, c.segment_filter ?? {});
    const kuota = await kuotaHariIni(c.sender_domain);

    const pemeriksaan: Butir[] = [];

    // Identitas pengirim dan tautan berhenti berlangganan disisipkan penyusun
    // pesan, tidak diambil dari isi yang disunting pengguna. Butir ini lolos
    // secara struktural — dicantumkan supaya terlihat di UI bahwa keduanya
    // memang ada, bukan supaya bisa gagal.
    pemeriksaan.push({ butir: "identitas_pengirim", lolos: true });
    pemeriksaan.push({ butir: "tautan_berhenti", lolos: true });

    pemeriksaan.push({
      butir: "penekanan_dikeluarkan",
      lolos: true,
      jumlah: audiens.tersuppress,
    });
    pemeriksaan.push({
      butir: "karantina_dikeluarkan",
      lolos: true,
      jumlah: audiens.terkarantina,
    });

    pemeriksaan.push({
      butir: "penerima_ada",
      lolos: audiens.layak > 0,
      jumlah: audiens.layak,
      pesan:
        audiens.layak > 0
          ? undefined
          : audiens.kandidat > 0
            ? "Semua kontak pada segmen ini tersuppress atau masih terkarantina"
            : "Segmen tidak menghasilkan satu kontak pun",
    });

    const muat = kuota.sisa === null || audiens.layak <= kuota.sisa;
    pemeriksaan.push({
      butir: "batas_pemanasan",
      lolos: muat,
      jumlah: kuota.sisa ?? undefined,
      pesan: muat
        ? undefined
        : `${audiens.layak} penerima melebihi sisa kuota ${kuota.sisa} hari ini ` +
          `(tahap pemanasan ${kuota.stage})`,
    });

    // Penanda yang tidak terisi tidak memblokir. Pesan yang memuat
    // "{{nama_perusahaan}}" secara harfiah memalukan, tapi memblokir kampanye
    // karena satu kontak tidak punya nama perusahaan akan lebih sering
    // mengganggu daripada menolong.
    const hilang = penandaTidakTerisi(`${c.subject} ${c.body_text}`, {
      nama_perusahaan: "ada",
      email: "ada",
    });
    pemeriksaan.push({
      butir: "penanda_terisi",
      lolos: hilang.length === 0,
      peringatan: true,
      pesan:
        hilang.length === 0
          ? undefined
          : `Penanda tidak dikenali: ${hilang.map((h) => `{{${h}}}`).join(", ")}`,
    });

    const gagalMemblokir = pemeriksaan.some((b) => !b.lolos && !b.peringatan);

    return {
      dapat_dikirim: !gagalMemblokir,
      pemeriksaan,
      ringkasan: {
        kandidat: audiens.kandidat,
        layak_kirim: audiens.layak,
        tersuppress: audiens.tersuppress,
        terkarantina: audiens.terkarantina,
        sisa_kuota: kuota.sisa,
        tahap_pemanasan: kuota.stage,
        // Batas harian penuh diteruskan sebagai argumen ketiga: sisa hari
        // ini mungkin sudah terpakai sebagian, hari-hari berikutnya tidak.
        tanggal_muat: tanggalMuat(kuota.sisa, audiens.layak, kuota.batasHarian),
      },
    };
  } finally {
    client.release();
  }
}
