// Daftar pekerjaan terjadwal beserta frekuensinya, sesuai 01-arsitektur.md.
//
// `send-worker` sudah terisi. Sisanya masih kosong, dan `phase` menyatakan
// fase mana yang mengisinya.

import { runSendWorker } from "./send-worker.js";

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
    run: runSendWorker,
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
    // Hapus kontak tanpa respons sesuai kebijakan retensi.
    run: pending("retention-sweep"),
  },
];
