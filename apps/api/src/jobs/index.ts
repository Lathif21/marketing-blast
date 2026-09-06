// Daftar pekerjaan terjadwal beserta frekuensinya, sesuai 01-arsitektur.md.
//
// `send-worker` sudah terisi. Sisanya masih kosong, dan `phase` menyatakan
// fase mana yang mengisinya.

import { runSendWorker } from "./send-worker.js";
import { perTenant } from "./per-tenant.js";
import { sapuSesiKedaluwarsa } from "../auth/repo.js";
import { runFollowupWorker } from "./followup-worker.js";
import { runGmailSync } from "./gmail-worker.js";
import { runEngagementRecalc, runRetentionSweep } from "./respons-worker.js";

export interface Job {
  name: string;
  /** Jeda antar-jalan dalam milidetik. */
  intervalMs: number;
  /** Fase di 06-rencana-build.md yang mengisi handler ini. */
  phase: number;
  run: () => Promise<void>;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Sejak multi-tenant, pekerjaan yang menyentuh data pelanggan dibungkus
 * `perTenant`. Yang tidak dibungkus hanya pekerjaan lintas-instalasi — dan
 * satu-satunya sekarang adalah penyapuan sesi.
 *
 * Belum diimplementasikan. Sengaja tidak melempar error: penjadwal harus bisa
 * dijalankan utuh di Fase 0 tanpa membuat container restart terus-menerus.
 */
const pending = (name: string) => async () => {
  console.info(`[job] ${name}: belum diimplementasikan, dilewati`);
};

export const JOBS: Job[] = [
  {
    name: "send-worker",
    intervalMs: MINUTE,
    phase: 2,
    // Ambil antrean, kirim sesuai batas harian yang berlaku.
    //
    // Sempat tertinggal sebagai stub setelah handler-nya ditulis: handler ada,
    // tapi penjadwal tetap memanggil `pending`. Akibatnya worker mencatat
    // "belum diimplementasikan" tiap menit dan tidak ada satu pun pesan yang
    // diproses — kegagalan yang tidak menimbulkan galat sama sekali.
    run: perTenant("aktif", "send-worker", runSendWorker),
  },
  {
    name: "followup-enroll",
    // Lebih jarang daripada send-worker dengan sengaja. Yang dikejar bukan
    // kecepatan: jeda tindak lanjut diukur dalam jam, jadi memeriksa tiap
    // menit hanya menambah query tanpa mengubah kapan pesannya keluar.
    intervalMs: 10 * MINUTE,
    phase: 4,
    // Daftarkan penerima yang bereaksi ke kampanye tindak lanjutnya.
    run: perTenant("aktif", "followup", runFollowupWorker),
  },
  {
    name: "gmail-sync",
    // Balasan adalah sinyal ketertarikan terkuat, dan jeda tindak lanjut
    // diukur dalam jam — memeriksa tiap sepuluh menit sudah jauh lebih cepat
    // daripada yang dibutuhkan, sekaligus menahan pemakaian kuota Gmail API.
    intervalMs: 10 * MINUTE,
    phase: 5,
    // Baca kotak masuk yang tersambung: catat balasan, impor korespondensi.
    run: perTenant("hidup", "gmail", runGmailSync),
  },
  {
    name: "engagement-recalc",
    intervalMs: HOUR,
    phase: 4,
    // Nilai ulang `contacts.respons` dari event pengiriman terbaru.
    run: perTenant("hidup", "engagement", runEngagementRecalc),
  },
  {
    name: "verify-worker",
    intervalMs: 5 * MINUTE,
    phase: 3,
    // Verifikasi alamat kontak karantina (email_origin = guessed).
    run: pending("verify-worker"),
  },
  {
    name: "health-recalc",
    intervalMs: HOUR,
    phase: 3,
    // Hitung ulang rata-rata bergerak bounce dan keluhan 7 hari.
    run: pending("health-recalc"),
  },
  {
    name: "warmup-advance",
    intervalMs: DAY,
    phase: 3,
    // Naikkan tahap pemanasan HANYA bila metrik dalam batas aman. Kenaikan
    // tidak boleh otomatis karena hari berganti (04-aturan-kepatuhan.md §3).
    run: pending("warmup-advance"),
  },
  {
    name: "retention-sweep",
    intervalMs: 30 * DAY,
    phase: 4,
    // Laporkan kontak tanpa respons. Penghapusannya tetap keputusan orang —
    // lihat catatan di respons-worker.ts.
    run: perTenant("hidup", "retensi", runRetentionSweep),
  },
  {
    name: "sesi-sweep",
    intervalMs: HOUR,
    phase: 5,
    // Membuang sesi kedaluwarsa. Satu-satunya pekerjaan yang TIDAK per
    // pelanggan: tabel `sessions` berada di luar penyaringan tenant, karena
    // ialah yang menetapkan tenant (lihat migrasi 010).
    run: async () => {
      const dibuang = await sapuSesiKedaluwarsa();
      if (dibuang > 0) console.info(`[sesi-sweep] ${dibuang} sesi kedaluwarsa dibuang`);
    },
  },
];
