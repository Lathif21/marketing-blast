// Jadwal pemanasan domain, sesuai 04-aturan-kepatuhan.md §3.
//
// Ditaruh di kode karena ini aturan yang ditegakkan, bukan konfigurasi:
// domain baru tidak dapat langsung mengirim volume penuh, dan batas hariannya
// tidak dapat dinonaktifkan pengguna.
//
// `hariPalingCepat` adalah hari PALING AWAL sebuah tahap boleh dicapai, bukan
// jadwal otomatis. Kenaikan tahap tidak terjadi karena hari berganti — hanya
// `warmup-advance` yang menaikkannya, dan hanya bila bounce serta keluhan
// berada dalam batas aman. Membedakan keduanya penting: menaikkan volume saat
// metrik memburuk justru mempercepat kerusakan.

export interface WarmupStage {
  stage: number;
  hariPalingCepat: number;
  /** `null` pada tahap terakhir: tidak ada batas tetap lagi. */
  dailyLimit: number | null;
}

export const WARMUP_STAGES: WarmupStage[] = [
  { stage: 1, hariPalingCepat: 1, dailyLimit: 50 },
  { stage: 2, hariPalingCepat: 4, dailyLimit: 100 },
  { stage: 3, hariPalingCepat: 8, dailyLimit: 500 },
  { stage: 4, hariPalingCepat: 15, dailyLimit: 2000 },
  { stage: 5, hariPalingCepat: 22, dailyLimit: null },
];

export const TOTAL_STAGES = WARMUP_STAGES.length;

/** Tahap awal setiap domain pengirim yang belum pernah mengirim apa pun. */
export const TAHAP_AWAL = 1;

export function batasHarian(stage: number): number | null {
  return WARMUP_STAGES.find((s) => s.stage === stage)?.dailyLimit ?? null;
}

/**
 * Ambang yang mengubah panel ke keadaan peringatan. Dikirim dari server, bukan
 * ditanam di UI, supaya angkanya satu sumber — ambang yang berbeda antara
 * tampilan dan pemeriksaan pra-kirim adalah cara paling cepat kehilangan
 * kepercayaan pada keduanya.
 */
export const AMBANG = {
  bounce: { perhatian: 2, kritis: 5 },
  keluhan: { perhatian: 0.1, kritis: 0.3 },
} as const;
