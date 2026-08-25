// Data tiruan untuk prototype. Setiap konstanta di sini adalah titik yang harus
// diganti panggilan API — lihat lib/api.ts untuk endpoint padanannya.
//
// Aturan isi: tidak ada sumber izin yang bertentangan dengan keputusan
// kepatuhan. Sourcing LinkedIn dikeluarkan dari lingkup, jadi tidak boleh
// muncul sebagai contoh sekalipun (05-revisi-desain.md, Revisi 6).

import type {
  Campaign,
  Contact,
  ContactDistributionSlice,
  DomainHealth,
  FunnelStage,
  Segment,
  SuppressionEntry,
} from "./types";

// ─── Kesehatan domain — GET /domain/health ───────────────────────────────────

export const DOMAIN: DomainHealth = {
  name: "blast.nusantarasales.id",
  bounceRate: 1.8,
  complaintRate: 0.04,
  warmupStage: 3,
  warmupTotal: 5,
  dailyLimit: 500,
  sentToday: 187,
};

export const DAILY_REMAINING = DOMAIN.dailyLimit - DOMAIN.sentToday;

// ─── Kampanye — GET /campaigns ───────────────────────────────────────────────

export const CAMPAIGNS: Campaign[] = [
  { id: "C001", name: "Penawaran Q3 – Manufaktur",   status: "selesai", recipients: 450, opened: 187, clicked: 43, bounced: 9, date: "15 Sep 2024" },
  { id: "C002", name: "Follow-up Demo – Teknologi",  status: "aktif",   recipients: 120, opened: 54,  clicked: 12, bounced: 2, date: "20 Sep 2024" },
  { id: "C003", name: "Promo Akhir Tahun – Retail",  status: "draft",   recipients: 0,   opened: 0,   clicked: 0,  bounced: 0, date: "22 Sep 2024" },
  { id: "C004", name: "Undangan Webinar – Keuangan", status: "selesai", recipients: 380, opened: 201, clicked: 67, bounced: 4, date: "10 Sep 2024" },
  { id: "C005", name: "Perkenalan Produk – FMCG",    status: "selesai", recipients: 310, opened: 144, clicked: 31, bounced: 7, date: "05 Sep 2024" },
];

// ─── Kontak — GET /contacts ──────────────────────────────────────────────────
//
// Baris berstatus `karantina` selalu punya `emailOrigin: "guessed"`. Itu memang
// satu-satunya alasan karantina pada tahap impor (04-aturan-kepatuhan.md §4) —
// bukan sumber izinnya, yang justru sah untuk ketiga baris tersebut.

export const CONTACTS: Contact[] = [
  { id: 1,  company: "PT Astra International Tbk",    email: "procurement@astra.co.id",     consent: "Formulir web",                emailOrigin: "found",   status: "aktif",     date: "12 Agt 2024" },
  { id: 2,  company: "PT Telkom Indonesia",           email: "vendor@telkom.co.id",         consent: "Alamat generik terpublikasi", emailOrigin: "guessed", status: "karantina", date: "14 Agt 2024" },
  { id: 3,  company: "PT Bank Mandiri Tbk",           email: "supply@bankmandiri.co.id",    consent: "Pameran dagang",              emailOrigin: "found",   status: "aktif",     date: "15 Agt 2024" },
  { id: 4,  company: "PT Unilever Indonesia",         email: "b2b@unilever.co.id",          consent: "Formulir web",                emailOrigin: "found",   status: "aktif",     date: "15 Agt 2024" },
  { id: 5,  company: "PT Indofood CBP Sukses Makmur", email: "vendor@indofood.co.id",       consent: "Referral mitra",              emailOrigin: "found",   status: "aktif",     date: "18 Agt 2024" },
  { id: 6,  company: "PT Bank Central Asia Tbk",      email: "corp@bca.co.id",              consent: "Alamat generik terpublikasi", emailOrigin: "guessed", status: "karantina", date: "19 Agt 2024" },
  { id: 7,  company: "CV Teknologi Maju Bersama",     email: "info@tekmabes.id",            consent: "Formulir web",                emailOrigin: "found",   status: "aktif",     date: "20 Agt 2024" },
  { id: 8,  company: "PT Garuda Indonesia",           email: "cargo@garuda.co.id",          consent: "Pameran dagang",              emailOrigin: "found",   status: "diblokir",  date: "20 Agt 2024" },
  { id: 9,  company: "PT Pertamina Persero",          email: "procurement@pertamina.co.id", consent: "Formulir web",                emailOrigin: "found",   status: "aktif",     date: "21 Agt 2024" },
  { id: 10, company: "PT Sinarmas Agribusiness",      email: "sales@sinarmas.co.id",        consent: "Referral mitra",              emailOrigin: "found",   status: "aktif",     date: "22 Agt 2024" },
  { id: 11, company: "PT Krakatau Steel",             email: "b2b@krakatausteel.co.id",     consent: "Alamat generik terpublikasi", emailOrigin: "guessed", status: "karantina", date: "22 Agt 2024" },
  { id: 12, company: "PT Gojek Indonesia",            email: "corp@gojek.com",              consent: "Formulir web",                emailOrigin: "found",   status: "aktif",     date: "23 Agt 2024" },
  { id: 13, company: "PT Tokopedia",                  email: "b2b@tokopedia.com",           consent: "Formulir web",                emailOrigin: "found",   status: "aktif",     date: "23 Agt 2024" },
  { id: 14, company: "PT PLN Persero",                email: "vendor@pln.co.id",            consent: "Pameran dagang",              emailOrigin: "found",   status: "aktif",     date: "24 Agt 2024" },
  { id: 15, company: "PT Mayora Indah Tbk",           email: "sales@mayora.co.id",          consent: "Referral mitra",              emailOrigin: "found",   status: "diblokir",  date: "24 Agt 2024" },
];

/** Alasan karantina yang ditampilkan ke pengguna, diturunkan dari `emailOrigin`. */
export const QUARANTINE_REASON =
  "Alamat hasil tebakan, belum diverifikasi — dikecualikan dari pengiriman sampai lolos verifikasi";

export const CONTACT_DISTRIBUTION: ContactDistributionSlice[] = [
  { label: "Aktif",                 count: 2847, color: "#5cc9a0", bar: "#2b7a5a", sub: "Siap dikirim"     },
  { label: "Karantina",             count: 134,  color: "#d4a040", bar: "#92680a", sub: "Perlu verifikasi" },
  { label: "Diblokir / Suppressed", count: 89,   color: "#e05252", bar: "#8c2e2e", sub: "Tidak dapat dikirim" },
];

// ─── Daftar penekanan — GET /suppression ─────────────────────────────────────

export const SUPPRESSION: SuppressionEntry[] = [
  { email: "noreply@badactor.id",     reason: "Keluhan spam",                     type: "Keluhan",     date: "14 Jul 2024" },
  { email: "blocked@corporate.co.id", reason: "Hard bounce – domain tidak valid", type: "Hard Bounce", date: "01 Agt 2024" },
  { email: "ceo@competitor.id",       reason: "Opt-out manual oleh pengguna",     type: "Manual",      date: "05 Agt 2024" },
  { email: "hr@problemcorp.co.id",    reason: "Keluhan spam",                     type: "Keluhan",     date: "11 Agt 2024" },
  { email: "info@nonexistent.id",     reason: "Hard bounce – pengguna tidak ada", type: "Hard Bounce", date: "15 Agt 2024" },
  { email: "admin@blacklisted.com",   reason: "Berhenti berlangganan",            type: "Unsubscribe", date: "18 Agt 2024" },
  { email: "sales@badomain.co.id",    reason: "Hard bounce – domain tidak valid", type: "Hard Bounce", date: "20 Agt 2024" },
  { email: "manager@spammy.co.id",    reason: "Keluhan spam",                     type: "Keluhan",     date: "21 Agt 2024" },
];

// ─── Laporan — GET /campaigns/:id/report ─────────────────────────────────────

export const REPORT_CAMPAIGN_ID = "C001";

export const FUNNEL: FunnelStage[] = [
  { key: "terkirim",     label: "Terkirim",              value: 450, color: "#2b7a5a", of: null,           ofLabel: null               },
  { key: "tersampaikan", label: "Tersampaikan",          value: 441, color: "#2b7a5a", of: "terkirim",     ofLabel: null               },
  { key: "dibuka",       label: "Dibuka",                value: 187, color: "#c4824a", of: "tersampaikan", ofLabel: null               },
  { key: "diklik",       label: "Diklik",                value: 43,  color: "#c4824a", of: "dibuka",       ofLabel: null               },
  { key: "bounced",      label: "Bounced",               value: 9,   color: "#8c2e2e", of: "terkirim",     ofLabel: "dr. terkirim"     },
  { key: "unsub",        label: "Berhenti Berlangganan", value: 3,   color: "#8c2e2e", of: "tersampaikan", ofLabel: "dr. tersampaikan" },
];

export const funnelValue = (key: string) => FUNNEL.find((f) => f.key === key)?.value ?? 0;

export const COMPARISON_DATA = CAMPAIGNS.filter((c) => c.recipients > 0).map((c) => ({
  name: c.id === REPORT_CAMPAIGN_ID ? `${c.id} (ini)` : c.id,
  buka: Number(((c.opened / c.recipients) * 100).toFixed(1)),
  klik: Number(((c.clicked / c.recipients) * 100).toFixed(1)),
  bounce: Number(((c.bounced / c.recipients) * 100).toFixed(1)),
}));

export const REPORT_HEALTH_IMPACT = [
  { label: "Bounce Rate",     before: "1.6%",  after: "1.8%",  delta: "+0.2%",  warn: true  },
  { label: "Complaint Rate",  before: "0.03%", after: "0.04%", delta: "+0.01%", warn: false },
  { label: "Reputasi Domain", before: "Baik",  after: "Baik",  delta: "Stabil", warn: false },
];

// ─── Penyusun kampanye ───────────────────────────────────────────────────────

export const SEGMENTS: Segment[] = [
  { id: "all",        label: "Semua Kontak Aktif",             count: 2847 },
  { id: "manufaktur", label: "Industri: Manufaktur",           count: 312  },
  { id: "teknologi",  label: "Industri: Teknologi",            count: 198  },
  { id: "keuangan",   label: "Industri: Keuangan & Perbankan", count: 267  },
  { id: "retail",     label: "Industri: Retail & FMCG",        count: 441  },
  { id: "recent",     label: "Impor Terakhir (30 hari)",       count: 183  },
];

// ─── Impor — POST /imports ───────────────────────────────────────────────────

export const CSV_COLS = ["nama_perusahaan", "email_bisnis", "industri", "kota", "telepon"];

export const CSV_ROWS = [
  ["PT Maju Jaya Abadi", "kontak@majujaya.co.id",     "Manufaktur",  "Surabaya", "+62 31 5551234"],
  ["CV Teknologi Prima", "info@tekprima.id",          "Teknologi",   "Bandung",  "+62 22 4442345"],
  ["PT Sumber Rejeki",   "bisnis@sumberrejeki.co.id", "Perdagangan", "Medan",    "+62 61 6663456"],
  ["PT Karya Mandiri",   "ceo@karyamandiri.id",       "Jasa",        "Jakarta",  "+62 21 3334567"],
  ["UD Harapan Jaya",    "owner@harapanjaya.co.id",   "Retail",      "Makassar", "+62 411 7775678"],
];

export const IMPORT_FILENAME = "kontak_manufaktur_sep2024.csv";
export const IMPORT_ROW_COUNT = 1342;

export const IMPORT_SUMMARY = [
  { label: "Diterima",    count: 1247, color: "#5cc9a0", bg: "rgba(43,122,90,0.15)",  desc: "Siap diimpor" },
  { label: "Dikarantina", count: 18,   color: "#d4a040", bg: "rgba(180,120,30,0.15)", desc: "Alamat tebakan, perlu verifikasi" },
  { label: "Duplikat",    count: 54,   color: "#8da0b8", bg: "rgba(106,130,160,0.1)", desc: "Sudah ada di sistem" },
  { label: "Ditolak",     count: 23,   color: "#e05252", bg: "rgba(140,46,46,0.15)",  desc: "Format tidak valid" },
];

export const IMPORT_NOTES: { type: "warn" | "info" | "error"; text: string }[] = [
  { type: "warn",  text: "18 kontak dikarantina – alamat hasil tebakan (email_source = guessed), wajib lolos verifikasi sebelum dapat dikirimi" },
  { type: "info",  text: "54 alamat email duplikat tidak akan diimpor" },
  { type: "error", text: "23 baris ditolak: 11 format email tidak valid, 12 nama perusahaan kosong" },
];

// ─── Identitas pengirim ──────────────────────────────────────────────────────
// Disisipkan di sisi server saat penyusunan pesan; di prototype hanya dipakai
// untuk pratinjau (04-aturan-kepatuhan.md §1).

export const SENDER = {
  name: "Nusantara Sales",
  email: "blast@nusantarasales.id",
  address: "Jl. Sudirman No. 45, Jakarta Selatan 12190",
  company: "Nusantara Solutions",
};
