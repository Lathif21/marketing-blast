// Daftar pekerjaan terjadwal beserta frekuensinya, sesuai 01-arsitektur.md.
//
// Semua handler masih kosong. Yang sudah tetap adalah nama, frekuensi, dan
// urutan fase pengerjaannya — supaya penjadwalnya bisa diuji lebih dulu tanpa
// menunggu logika pengiriman siap.

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
    run: pending("send-worker"),
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
