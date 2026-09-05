// Pemeriksaan pra-kirim.
//
// Dijalankan di server, bukan di UI. Antarmuka bisa dilewati, endpoint tidak
// (04-aturan-kepatuhan.md). Hasil pemeriksaan yang gagal MEMBLOKIR pengiriman,
// bukan sekadar memberi peringatan — kalau butir yang gagal masih bisa
// dilanjutkan, butir itu bukan aturan melainkan saran.

import type { PoolClient } from "pg";
import { clientKonteks, konteksSaatIni } from "../db.js";
import { bolehMengirim } from "../tenants/repo.js";
import { kuotaHariIni, tanggalMuat } from "../domain/quota.js";
import { penandaTidakTerisi } from "./compose.js";
import { kondisiSegmen } from "./segment.js";
import { filterEfektif, LABEL_PEMICU, type Pemicu } from "./followup.js";

export type ButirId =
  | "identitas_pengirim"
  | "tautan_berhenti"
  | "penekanan_dikeluarkan"
  | "karantina_dikeluarkan"
  | "penerima_ada"
  | "batas_pemanasan"
  | "penanda_terisi"
  | "pemicu_lanjutan"
  | "pelanggan_aktif";

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
  const segmen = kondisiSegmen(segmentFilter, 0);
  const kondisi = ["1 = 1", ...segmen.kondisi];
  const params = segmen.params;

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
  // Koneksi konteks, bukan koneksi baru dari kolam: variabel `app.tenant_id`
  // menempel pada koneksi, dan koneksi baru tidak akan melihat satu baris pun.
  const client = await clientKonteks();
  {
    const { rows } = await client.query<{
      subject: string;
      body_text: string;
      sender_domain: string;
      segment_filter: Record<string, unknown>;
      parent_campaign_id: string | null;
      pemicu: Pemicu | null;
      jeda_lanjutan_jam: number;
      nama_induk: string | null;
      terkirim_induk: string;
    }>(
      `SELECT c.subject, c.body_text, c.sender_domain, c.segment_filter,
              c.parent_campaign_id, c.pemicu, c.jeda_lanjutan_jam,
              induk.name AS nama_induk,
              (SELECT count(*)::text FROM campaign_recipients r
                WHERE r.campaign_id = c.parent_campaign_id
                  AND r.sent_at IS NOT NULL) AS terkirim_induk
         FROM campaigns c
         LEFT JOIN campaigns induk ON induk.id = c.parent_campaign_id
        WHERE c.id = $1`,
      [campaignId],
    );
    if (rows.length === 0) throw new Error("kampanye tidak ditemukan");
    const c = rows[0];

    // Segmen efektif, bukan `segment_filter` mentah: kampanye tindak lanjut
    // hanya menyasar penerima induk yang bereaksi, dan angka yang dipakai
    // memutuskan boleh-tidaknya mengirim harus angka yang sama dengan yang
    // benar-benar diantrekan.
    const audiens = await hitungAudiens(client, filterEfektif(c));
    const kuota = await kuotaHariIni(c.sender_domain);

    const pemeriksaan: Butir[] = [];

    // Pembekuan pelanggan ditegakkan DI SINI, bukan hanya di antarmuka.
    //
    // `send-worker` sudah melewati pelanggan yang dibekukan, jadi butir ini
    // secara teknis berlebihan untuk menghentikan pengiriman. Ia tetap ada
    // karena jawaban yang benar untuk "kenapa kampanye saya tidak jalan"
    // harus muncul di tempat pengguna menekan tombol kirim — bukan hanya
    // sebagai antrean yang tidak pernah bergerak tanpa penjelasan apa pun.
    const tenantId = konteksSaatIni()?.tenantId;
    if (tenantId) {
      const izin = await bolehMengirim(tenantId);
      pemeriksaan.push({
        butir: "pelanggan_aktif",
        lolos: izin.boleh,
        pesan: izin.boleh
          ? undefined
          : izin.status === "dibekukan"
            ? `Pengiriman dibekukan penyedia layanan${izin.alasan ? `: ${izin.alasan}` : "."} ` +
              "Data Anda tetap utuh; hubungi penyedia layanan untuk melanjutkan."
            : "Akun ini tidak aktif. Hubungi penyedia layanan.",
      });
    }

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

    // Butir penjelas, bukan penghalang. Kampanye lanjutan tanpa penerima
    // gagal di `penerima_ada`, dan tanpa butir ini pesannya berbunyi "segmen
    // tidak menghasilkan satu kontak pun" — benar, tapi tidak menjelaskan
    // bahwa yang kurang adalah reaksi atas kampanye induk, bukan segmennya.
    if (c.parent_campaign_id && c.pemicu) {
      const terkirimInduk = Number(c.terkirim_induk ?? 0);
      pemeriksaan.push({
        butir: "pemicu_lanjutan",
        lolos: true,
        peringatan: true,
        jumlah: terkirimInduk,
        pesan:
          `Menyasar penerima "${c.nama_induk ?? "kampanye induk"}" yang ` +
          `${LABEL_PEMICU[c.pemicu].toLowerCase()}, minimal ${c.jeda_lanjutan_jam} jam lalu` +
          (terkirimInduk === 0
            ? " — kampanye induk belum mengirim satu pesan pun, jadi belum ada yang dapat bereaksi"
            : ` (${terkirimInduk} pesan induk terkirim)`),
      });
    }

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
  }
}
