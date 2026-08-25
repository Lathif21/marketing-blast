// SISA data contoh untuk layar yang BELUM tersambung ke API.
//
// Isi berkas ini menyusut setiap kali satu layar tersambung. Yang tersisa
// hanya dipakai dua tempat:
//
//   ReportScreen          — laporan kampanye; tabel `campaigns` belum ada
//   CampaignBuilderScreen — daftar segmen; penyusunan segmen belum dibangun
//
// Angka kesehatan domain dan kuota harian SUDAH TIDAK ADA di sini. Keduanya
// kini datang dari GET /domain/health, dan sengaja dihapus dari berkas ini:
// selama masih diekspor, satu impor tidak sengaja cukup untuk menampilkan
// bounce 1,8% dan sisa kuota 313 yang terlihat meyakinkan padahal tidak ada
// dasarnya. Pada layar pertama yang dilihat pengguna — apalagi saat produk
// didemokan — itu kekeliruan yang mahal.
//
// Aturan untuk apa pun yang ditambahkan ke sini: kalau angkanya bisa
// disalahartikan sebagai keadaan sungguhan, ia tidak boleh masuk. Yang belum
// terukur ditampilkan sebagai "belum ada data", bukan sebagai nol atau contoh.

import type { Campaign, FunnelStage, Segment } from "./types";

/**
 * Alasan karantina yang ditampilkan ke pengguna. Bukan data tiruan — ini teks
 * tetap, diturunkan dari `email_origin = guessed` (04-aturan-kepatuhan.md §4).
 */
export const QUARANTINE_REASON =
  "Alamat hasil tebakan, belum diverifikasi — dikecualikan dari pengiriman sampai lolos verifikasi";

// ─── Kampanye — GET /campaigns ───────────────────────────────────────────────

export const CAMPAIGNS: Campaign[] = [
  { id: "C001", name: "Penawaran Q3 – Manufaktur",   status: "selesai", recipients: 450, opened: 187, clicked: 43, bounced: 9, date: "15 Sep 2024" },
  { id: "C002", name: "Follow-up Demo – Teknologi",  status: "aktif",   recipients: 120, opened: 54,  clicked: 12, bounced: 2, date: "20 Sep 2024" },
  { id: "C003", name: "Promo Akhir Tahun – Retail",  status: "draft",   recipients: 0,   opened: 0,   clicked: 0,  bounced: 0, date: "22 Sep 2024" },
  { id: "C004", name: "Undangan Webinar – Keuangan", status: "selesai", recipients: 380, opened: 201, clicked: 67, bounced: 4, date: "10 Sep 2024" },
  { id: "C005", name: "Perkenalan Produk – FMCG",    status: "selesai", recipients: 310, opened: 144, clicked: 31, bounced: 7, date: "05 Sep 2024" },
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

// ─── Identitas pengirim ──────────────────────────────────────────────────────
// Disisipkan di sisi server saat penyusunan pesan; di prototype hanya dipakai
// untuk pratinjau (04-aturan-kepatuhan.md §1).

export const SENDER = {
  name: "Nusantara Sales",
  email: "blast@nusantarasales.id",
  address: "Jl. Sudirman No. 45, Jakarta Selatan 12190",
  company: "Nusantara Solutions",
};
