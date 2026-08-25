// GET /domain/health
//
// Aturan modul ini: TIDAK PERNAH mengarang angka.
//
// Sebagian metrik belum punya sumber data — tabel `campaign_recipients` belum
// ada, dan webhook SES belum menerima apa pun. Untuk metrik itu jawabannya
// `null`, bukan 0.
//
// Perbedaannya bukan soal kerapian. Bounce 0% terbaca sebagai "sangat sehat",
// sedangkan yang sebenarnya terjadi adalah "belum ada satu pun email terkirim
// sehingga tidak ada yang bisa diukur". Menampilkan 0 pada layar pertama yang
// dilihat pengguna — apalagi saat produk didemokan — adalah kekeliruan yang
// mahal justru karena angkanya terlihat meyakinkan.
//
// `sumber` di respons menyatakan asal setiap kelompok angka, supaya UI dapat
// membedakan "sehat" dari "belum terukur" tanpa menebak.

import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { pool } from "../db.js";
import { AMBANG, TAHAP_AWAL, TOTAL_STAGES, batasHarian } from "../domain/warmup.js";

type Ketersediaan = "tersedia" | "belum_ada_pengiriman" | "belum_terpasang";

export async function domainRoutes(app: FastifyInstance) {
  app.get("/domain/health", async () => {
    // Satu-satunya angka reputasi yang sudah nyata hari ini: jumlah alamat
    // yang tidak akan pernah dikirimi lagi.
    const { rows } = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM suppression",
    );
    const suppressionTotal = Number(rows[0].count);

    // Belum ada tabel pengiriman, jadi belum ada riwayat kirim. Ini bukan
    // asumsi: kalau tabelnya ada nanti, angka di bawah diambil dari sana.
    const adaRiwayatKirim = false;

    const stage = TAHAP_AWAL;
    const dailyLimit = batasHarian(stage);
    const sentToday = 0;

    const pengiriman: Ketersediaan = adaRiwayatKirim ? "tersedia" : "belum_ada_pengiriman";
    const reputasi: Ketersediaan = adaRiwayatKirim ? "tersedia" : "belum_ada_pengiriman";

    return {
      domain: config.sender.domain,

      warmup: {
        stage,
        total_stages: TOTAL_STAGES,
        daily_limit: dailyLimit,
        sent_today: sentToday,
        remaining_today: dailyLimit === null ? null : dailyLimit - sentToday,
        /** Hari ke berapa domain ini mengirim. `null` = belum pernah mengirim. */
        days_sending: adaRiwayatKirim ? 0 : null,
      },

      reputation: {
        // null, BUKAN 0. Lihat catatan di kepala berkas.
        bounce_rate_7d: null as number | null,
        complaint_rate_7d: null as number | null,
        thresholds: AMBANG,
      },

      /** Nyata dan dapat dipercaya sejak hari pertama. */
      suppression_total: suppressionTotal,

      sumber: {
        warmup: adaRiwayatKirim ? "tercatat" : ("bawaan_domain_baru" as string),
        pengiriman,
        reputasi,
      },

      diperbarui_pada: new Date().toISOString(),
    };
  });
}
