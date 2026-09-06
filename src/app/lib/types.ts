// Tipe bersama untuk seluruh antarmuka.
//
// Nilai enum di sini sama persis dengan enum PostgreSQL di apps/api/migrations.
// Label tampilannya dipisah ke tabel di bawah — teks yang dilihat pengguna
// boleh berubah tanpa menyentuh skema.

export type Screen =
  | "dashboard"
  | "import"
  | "contacts"
  | "builder"
  | "followup"
  | "report"
  | "superadmin"
  | "suppression";

export type ImportStep = 1 | 2 | 3;
export type BuilderStep = 1 | 2 | 3;

export type ContactStatus = "aktif" | "karantina" | "diblokir";
export type CampaignStatus = "draft" | "aktif" | "selesai";

/** Asal alamat email. `guessed` wajib masuk karantina — lihat 04-aturan-kepatuhan.md §4. */
export type EmailOrigin = "found" | "guessed" | "manual";

/**
 * Sumber izin yang sah. Sourcing LinkedIn dikeluarkan dari lingkup produk,
 * jadi tidak ada nilainya di sini — baik sebagai enum maupun sebagai contoh.
 */
export type ConsentSource =
  | "pelanggan_existing"
  | "formulir_web"
  | "izin_lisan"
  | "pameran"
  | "referral"
  | "alamat_generik_terpublikasi"
  /** Hanya dihasilkan integrasi Gmail — tidak dapat dipilih saat impor berkas. */
  | "korespondensi_dua_arah"
  | "lainnya";

export const CONSENT_LABELS: Record<ConsentSource, string> = {
  pelanggan_existing: "Pelanggan existing",
  formulir_web: "Formulir web",
  izin_lisan: "Izin lisan",
  pameran: "Pameran dagang",
  referral: "Referral mitra",
  alamat_generik_terpublikasi: "Alamat generik terpublikasi",
  korespondensi_dua_arah: "Korespondensi dua arah",
  lainnya: "Lainnya",
};

/**
 * Yang dapat DIPILIH saat impor berkas. `korespondensi_dua_arah` dikeluarkan:
 * ia menyatakan bukti yang hanya dapat ditegakkan integrasi Gmail, dan
 * membiarkannya dipilih pada impor CSV mengubah bukti menjadi klaim.
 */
export const CONSENT_SOURCES = (Object.keys(CONSENT_LABELS) as ConsentSource[]).filter(
  (s) => s !== "korespondensi_dua_arah",
);

export type ConsentStrength = "kuat" | "cukup" | "perlu_ditinjau";

export interface Contact {
  id: string;
  company: string;
  email: string;
  consent: ConsentSource;
  emailOrigin: EmailOrigin;
  status: ContactStatus;
  /** Tanggal impor, sudah diformat untuk ditampilkan. */
  date: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: CampaignStatus;
  recipients: number;
  opened: number;
  clicked: number;
  bounced: number;
  date: string;
}

export type SuppressionReason = "unsubscribe" | "hard_bounce" | "keluhan" | "manual";

export const SUPPRESSION_LABELS: Record<SuppressionReason, string> = {
  unsubscribe: "Unsubscribe",
  hard_bounce: "Hard Bounce",
  keluhan: "Keluhan",
  manual: "Manual",
};

/** Kalimat penjelas per alasan, ditampilkan di kolom Alasan. */
export const SUPPRESSION_TEXT: Record<SuppressionReason, string> = {
  unsubscribe: "Berhenti berlangganan atas permintaan penerima",
  hard_bounce: "Hard bounce — alamat tidak dapat menerima",
  keluhan: "Ditandai sebagai spam oleh penerima",
  manual: "Opt-out manual oleh pengguna",
};

export interface SuppressionEntry {
  email: string;
  reason: SuppressionReason;
  date: string;
}

// Bentuk kesehatan domain TIDAK didefinisikan di sini. Ia hidup di lib/api.ts
// bersama pemanggilannya, karena bentuknya harus mengikuti respons server —
// termasuk `null` pada metrik yang belum punya sumber data. Dua definisi untuk
// hal yang sama adalah cara tercepat keduanya berbeda tanpa ada yang sadar.

export interface Segment {
  id: string;
  label: string;
  count: number;
}

export interface FunnelStage {
  key: string;
  label: string;
  value: number;
  color: string;
  /** Tahap pembanding untuk menghitung persentase; null pada tahap pertama. */
  of: string | null;
  /** Teks pembanding eksplisit, dipakai bila persentase bukan terhadap tahap sebelumnya. */
  ofLabel: string | null;
}
