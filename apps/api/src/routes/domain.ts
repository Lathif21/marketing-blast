// GET /domain/health
//
// Aturan modul ini: TIDAK PERNAH mengarang angka.
//
// Angka kuota diambil dari `kuotaHariIni()` — sumber yang sama yang dipakai
// pemeriksaan pra-kirim dan worker pengiriman. Sebelumnya rute ini menuliskan
// `sent_today = 0` secara tetap, ditulis saat tabel `domain_daily_sends` belum
// ada. Setelah tabelnya ada, angkanya tidak pernah disambungkan: panel
// melaporkan sisa kuota 50 sementara pra-kirim menahan di 2. Dua angka untuk
// hal yang sama, dan yang ditampilkan justru yang salah.
//
// Metrik reputasi memang belum punya sumber: webhook SES belum menerima apa
// pun. Untuk itu jawabannya `null`, BUKAN 0. Bounce 0% terbaca "sangat sehat",
// padahal artinya "belum ada yang bisa diukur". Menampilkan 0 pada layar
// pertama yang dilihat pengguna adalah kekeliruan yang mahal justru karena
// angkanya terlihat meyakinkan.

import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { query } from "../db.js";
import { kuotaHariIni } from "../domain/quota.js";
import { AMBANG, TOTAL_STAGES, WARMUP_STAGES } from "../domain/warmup.js";

type Ketersediaan = "tersedia" | "belum_ada_pengiriman" | "belum_terpasang";

export async function domainRoutes(app: FastifyInstance) {
  app.get("/domain/health", async () => {
    const [kuota, { rows: supp }, { rows: kirim }] = await Promise.all([
      kuotaHariIni(config.sender.domain),
      query<{ count: string }>("SELECT count(*)::text AS count FROM suppression"),
      // Riwayat pengiriman menentukan apakah reputasi sudah dapat diukur.
      // Dibaca, bukan diasumsikan.
      query<{ count: string }>(
        "SELECT count(*)::text AS count FROM campaign_recipients WHERE sent_at IS NOT NULL",
      ),
    ]);

    const totalTerkirim = Number(kirim[0].count);
    const adaRiwayatKirim = totalTerkirim > 0;

    const pengiriman: Ketersediaan = adaRiwayatKirim ? "tersedia" : "belum_ada_pengiriman";
    // Bounce dan keluhan butuh webhook SES, yang belum menerima apa pun —
    // terpisah dari "sudah ada yang terkirim".
    const reputasi: Ketersediaan = "belum_ada_pengiriman";

    return {
      domain: config.sender.domain,

      // Identitas pengirim ikut dikirim supaya pratinjau pesan menampilkan
      // yang sebenarnya akan tercantum, bukan contoh. Nilainya disisipkan
      // server saat menyusun pesan dan tidak dapat diubah dari editor
      // (04-aturan-kepatuhan.md §1).
      sender: {
        name: config.sender.name,
        address: config.sender.address,
        postal_address: config.sender.postalAddress,
      },

      warmup: {
        stage: kuota.stage,
        total_stages: TOTAL_STAGES,
        daily_limit: kuota.batasHarian,
        sent_today: kuota.terpakaiHariIni,
        remaining_today: kuota.sisa,
        /** Jumlah pesan yang pernah keluar. `0` berarti belum pernah mengirim. */
        total_terkirim: totalTerkirim,
        /**
         * Jadwal lengkapnya, supaya UI dapat menggambar runway pemanasan
         * tanpa menyalin angkanya sendiri. Batas harian adalah aturan yang
         * ditegakkan, bukan hiasan — dua salinan yang berbeda berarti yang
         * ditampilkan bukan yang berlaku.
         */
        jadwal: WARMUP_STAGES.map((s) => ({
          stage: s.stage,
          daily_limit: s.dailyLimit,
          hari_paling_cepat: s.hariPalingCepat,
        })),
      },

      reputation: {
        // null, BUKAN 0. Lihat catatan di kepala berkas.
        bounce_rate_7d: null as number | null,
        complaint_rate_7d: null as number | null,
        thresholds: AMBANG,
      },

      /** Nyata dan dapat dipercaya sejak hari pertama. */
      suppression_total: Number(supp[0].count),

      sumber: {
        warmup: "tercatat",
        pengiriman,
        reputasi,
      },

      diperbarui_pada: new Date().toISOString(),
    };
  });
}
