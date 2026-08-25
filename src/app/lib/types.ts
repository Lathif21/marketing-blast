// Tipe bersama untuk seluruh antarmuka.
// Nilai enum mengikuti 02-model-data.md; label tampilan sengaja dipisah dari
// nilai basis data supaya perubahan teks tidak menyentuh skema.

export type Screen =
  | "dashboard"
  | "import"
  | "contacts"
  | "builder"
  | "report"
  | "suppression";

export type ImportStep = 1 | 2 | 3;
export type BuilderStep = 1 | 2 | 3;

export type ContactStatus = "aktif" | "karantina" | "diblokir";
export type CampaignStatus = "draft" | "aktif" | "selesai";

/** Asal alamat email. `guessed` wajib masuk karantina — lihat 04-aturan-kepatuhan.md §4. */
export type EmailOrigin = "found" | "guessed" | "manual";

/**
 * Sumber izin yang sah. Sourcing LinkedIn dikeluarkan dari lingkup produk,
 * jadi tidak boleh muncul di sini — baik sebagai nilai maupun sebagai contoh.
 */
export type ConsentSource =
  | "Pelanggan existing"
  | "Formulir web"
  | "Izin lisan"
  | "Pameran dagang"
  | "Referral mitra"
  | "Alamat generik terpublikasi";

export interface Contact {
  id: number;
  company: string;
  email: string;
  consent: ConsentSource;
  emailOrigin: EmailOrigin;
  status: ContactStatus;
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

export type SuppressionType = "Unsubscribe" | "Hard Bounce" | "Keluhan" | "Manual";

export interface SuppressionEntry {
  email: string;
  reason: string;
  type: SuppressionType;
  date: string;
}

export interface DomainHealth {
  name: string;
  bounceRate: number;
  complaintRate: number;
  warmupStage: number;
  warmupTotal: number;
  dailyLimit: number;
  sentToday: number;
}

export interface Segment {
  id: string;
  label: string;
  count: number;
}

export interface ContactDistributionSlice {
  label: string;
  count: number;
  color: string;
  bar: string;
  sub: string;
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
