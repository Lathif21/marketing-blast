import React, { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, BarChart2,
  Check, CheckCircle, Database, Download, Eye, Lock, Mail,
  Search, Send, Shield, Upload, Users, XCircle, AlertCircle,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Screen = "dashboard" | "import" | "contacts" | "builder" | "report" | "suppression";
type ImportStep = 1 | 2 | 3;
type BuilderStep = 1 | 2 | 3;

// ─── Mock data ────────────────────────────────────────────────────────────────

const DOMAIN = {
  name: "blast.nusantarasales.id",
  bounceRate: 1.8,
  complaintRate: 0.04,
  warmupStage: 3,
  warmupTotal: 5,
  dailyLimit: 500,
  sentToday: 187,
};

const DAILY_REMAINING = DOMAIN.dailyLimit - DOMAIN.sentToday;

const CAMPAIGNS = [
  { id: "C001", name: "Penawaran Q3 – Manufaktur", status: "selesai", recipients: 450, opened: 187, clicked: 43, bounced: 9, date: "15 Sep 2024" },
  { id: "C002", name: "Follow-up Demo – Teknologi", status: "aktif", recipients: 120, opened: 54, clicked: 12, bounced: 2, date: "20 Sep 2024" },
  { id: "C003", name: "Promo Akhir Tahun – Retail", status: "draft", recipients: 0, opened: 0, clicked: 0, bounced: 0, date: "22 Sep 2024" },
  { id: "C004", name: "Undangan Webinar – Keuangan", status: "selesai", recipients: 380, opened: 201, clicked: 67, bounced: 4, date: "10 Sep 2024" },
  { id: "C005", name: "Perkenalan Produk – FMCG", status: "selesai", recipients: 310, opened: 144, clicked: 31, bounced: 7, date: "05 Sep 2024" },
];

const CONTACTS = [
  { id: 1, company: "PT Astra International Tbk", email: "procurement@astra.co.id", consent: "Formulir web", status: "aktif", date: "12 Agt 2024" },
  { id: 2, company: "PT Telkom Indonesia", email: "vendor@telkom.co.id", consent: "LinkedIn", status: "karantina", date: "14 Agt 2024" },
  { id: 3, company: "PT Bank Mandiri Tbk", email: "supply@bankmandiri.co.id", consent: "Pameran dagang", status: "aktif", date: "15 Agt 2024" },
  { id: 4, company: "PT Unilever Indonesia", email: "b2b@unilever.co.id", consent: "Formulir web", status: "aktif", date: "15 Agt 2024" },
  { id: 5, company: "PT Indofood CBP Sukses Makmur", email: "vendor@indofood.co.id", consent: "Referensi mitra", status: "aktif", date: "18 Agt 2024" },
  { id: 6, company: "PT Bank Central Asia Tbk", email: "corp@bca.co.id", consent: "LinkedIn", status: "karantina", date: "19 Agt 2024" },
  { id: 7, company: "CV Teknologi Maju Bersama", email: "info@tekmabes.id", consent: "Formulir web", status: "aktif", date: "20 Agt 2024" },
  { id: 8, company: "PT Garuda Indonesia", email: "cargo@garuda.co.id", consent: "Pameran dagang", status: "diblokir", date: "20 Agt 2024" },
  { id: 9, company: "PT Pertamina Persero", email: "procurement@pertamina.co.id", consent: "Formulir web", status: "aktif", date: "21 Agt 2024" },
  { id: 10, company: "PT Sinarmas Agribusiness", email: "sales@sinarmas.co.id", consent: "Referensi mitra", status: "aktif", date: "22 Agt 2024" },
  { id: 11, company: "PT Krakatau Steel", email: "b2b@krakatausteel.co.id", consent: "LinkedIn", status: "karantina", date: "22 Agt 2024" },
  { id: 12, company: "PT Gojek Indonesia", email: "corp@gojek.com", consent: "Formulir web", status: "aktif", date: "23 Agt 2024" },
  { id: 13, company: "PT Tokopedia", email: "b2b@tokopedia.com", consent: "Formulir web", status: "aktif", date: "23 Agt 2024" },
  { id: 14, company: "PT PLN Persero", email: "vendor@pln.co.id", consent: "Pameran dagang", status: "aktif", date: "24 Agt 2024" },
  { id: 15, company: "PT Mayora Indah Tbk", email: "sales@mayora.co.id", consent: "Referensi mitra", status: "diblokir", date: "24 Agt 2024" },
];

const CONTACT_DISTRIBUTION = [
  { label: "Aktif",                 count: 2847, color: "#5cc9a0", bar: "#2b7a5a", sub: "Siap dikirim"        },
  { label: "Karantina",             count: 134,  color: "#d4a040", bar: "#92680a", sub: "Perlu verifikasi"    },
  { label: "Diblokir / Suppressed", count: 89,   color: "#e05252", bar: "#8c2e2e", sub: "Tidak dapat dikirim" },
];

const SUPPRESSION = [
  { email: "noreply@badactor.id", reason: "Keluhan spam", type: "Keluhan", date: "14 Jul 2024" },
  { email: "blocked@corporate.co.id", reason: "Hard bounce – domain tidak valid", type: "Hard Bounce", date: "01 Agt 2024" },
  { email: "ceo@competitor.id", reason: "Opt-out manual oleh pengguna", type: "Manual", date: "05 Agt 2024" },
  { email: "hr@problemcorp.co.id", reason: "Keluhan spam", type: "Keluhan", date: "11 Agt 2024" },
  { email: "info@nonexistent.id", reason: "Hard bounce – pengguna tidak ada", type: "Hard Bounce", date: "15 Agt 2024" },
  { email: "admin@blacklisted.com", reason: "Berhenti berlangganan", type: "Unsubscribe", date: "18 Agt 2024" },
  { email: "sales@badomain.co.id", reason: "Hard bounce – domain tidak valid", type: "Hard Bounce", date: "20 Agt 2024" },
  { email: "manager@spammy.co.id", reason: "Keluhan spam", type: "Keluhan", date: "21 Agt 2024" },
];

const FUNNEL = [
  { key: "terkirim",     label: "Terkirim",              value: 450, color: "#2b7a5a", of: null,           ofLabel: null              },
  { key: "tersampaikan", label: "Tersampaikan",          value: 441, color: "#2b7a5a", of: "terkirim",     ofLabel: null              },
  { key: "dibuka",       label: "Dibuka",                value: 187, color: "#c4824a", of: "tersampaikan", ofLabel: null              },
  { key: "diklik",       label: "Diklik",                value: 43,  color: "#c4824a", of: "dibuka",       ofLabel: null              },
  { key: "bounced",      label: "Bounced",               value: 9,   color: "#8c2e2e", of: "terkirim",     ofLabel: "dr. terkirim"     },
  { key: "unsub",        label: "Berhenti Berlangganan", value: 3,   color: "#8c2e2e", of: "tersampaikan", ofLabel: "dr. tersampaikan" },
];

const funnelValue = (key: string) => FUNNEL.find((f) => f.key === key)?.value ?? 0;

const REPORT_CAMPAIGN_ID = "C001";

const COMPARISON_DATA = CAMPAIGNS.filter((c) => c.recipients > 0).map((c) => ({
  name: c.id === REPORT_CAMPAIGN_ID ? `${c.id} (ini)` : c.id,
  buka:   Number(((c.opened  / c.recipients) * 100).toFixed(1)),
  klik:   Number(((c.clicked / c.recipients) * 100).toFixed(1)),
  bounce: Number(((c.bounced / c.recipients) * 100).toFixed(1)),
}));

const SEGMENTS = [
  { id: "all",        label: "Semua Kontak Aktif",             count: 2847 },
  { id: "manufaktur", label: "Industri: Manufaktur",           count: 312  },
  { id: "teknologi",  label: "Industri: Teknologi",            count: 198  },
  { id: "keuangan",   label: "Industri: Keuangan & Perbankan", count: 267  },
  { id: "retail",     label: "Industri: Retail & FMCG",        count: 441  },
  { id: "recent",     label: "Impor Terakhir (30 hari)",       count: 183  },
];

const CSV_COLS = ["nama_perusahaan", "email_bisnis", "industri", "kota", "telepon"];
const CSV_ROWS = [
  ["PT Maju Jaya Abadi", "kontak@majujaya.co.id", "Manufaktur", "Surabaya", "+62 31 5551234"],
  ["CV Teknologi Prima", "info@tekprima.id", "Teknologi", "Bandung", "+62 22 4442345"],
  ["PT Sumber Rejeki", "bisnis@sumberrejeki.co.id", "Perdagangan", "Medan", "+62 61 6663456"],
  ["PT Karya Mandiri", "ceo@karyamandiri.id", "Jasa", "Jakarta", "+62 21 3334567"],
  ["UD Harapan Jaya", "owner@harapanjaya.co.id", "Retail", "Makassar", "+62 411 7775678"],
];

// ─── Shared components ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    aktif:     { label: "Aktif",     color: "#5cc9a0", bg: "rgba(43,122,90,0.2)"   },
    karantina: { label: "Karantina", color: "#d4a040", bg: "rgba(180,120,30,0.15)" },
    diblokir:  { label: "Diblokir",  color: "#e05252", bg: "rgba(140,46,46,0.2)"   },
    selesai:   { label: "Selesai",   color: "#8da0b8", bg: "rgba(106,130,160,0.15)" },
    draft:     { label: "Draft",     color: "#6a82a0", bg: "rgba(100,130,160,0.1)" },
  };
  const c = map[status] ?? { label: status, color: "#6a82a0", bg: "rgba(100,130,160,0.1)" };
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono rounded-sm border"
      style={{ color: c.color, backgroundColor: c.bg, borderColor: `${c.color}30` }}
    >
      <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
      {c.label}
    </span>
  );
}

function SectionTitle({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="mb-4">
      <h2
        className="text-xs uppercase tracking-widest font-semibold"
        style={{ fontFamily: "'Barlow Condensed', sans-serif", color: "#dce3ec", letterSpacing: "0.12em" }}
      >
        {label}
      </h2>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function StepBar({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = current > n;
        const active = current === n;
        return (
          <div key={n} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                className="w-5 h-5 rounded-sm flex items-center justify-center text-xs font-mono font-medium flex-shrink-0"
                style={{
                  backgroundColor: done ? "#2b7a5a" : active ? "#c4824a" : "transparent",
                  color: done || active ? "#fff" : "#6a82a0",
                  border: done || active ? "none" : "1px solid rgba(100,140,180,0.2)",
                }}
              >
                {done ? <Check size={10} /> : n}
              </div>
              <span className="text-xs font-mono" style={{ color: active ? "#dce3ec" : "#6a82a0" }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="w-10 h-px mx-3" style={{ backgroundColor: done ? "#2b7a5a" : "rgba(100,140,180,0.18)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Th({ children, align = "left" }: { children?: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={`px-3 py-2 text-xs font-mono font-medium uppercase tracking-wider whitespace-nowrap ${align === "right" ? "text-right" : "text-left"}`}
      style={{ color: "#6a82a0" }}
    >
      {children}
    </th>
  );
}

// ─── Domain Health Panel ──────────────────────────────────────────────────────

function DomainHealthPanel() {
  const sentPct = (DOMAIN.sentToday / DOMAIN.dailyLimit) * 100;
  const bounceStatus = DOMAIN.bounceRate < 2 ? "ok" : DOMAIN.bounceRate < 5 ? "warn" : "risk";
  const complaintStatus = DOMAIN.complaintRate < 0.1 ? "ok" : DOMAIN.complaintRate < 0.3 ? "warn" : "risk";

  const col = (s: string) => s === "ok" ? "#5cc9a0" : s === "warn" ? "#d4a040" : "#e05252";
  const bg  = (s: string) => s === "ok" ? "rgba(43,122,90,0.13)" : s === "warn" ? "rgba(180,120,30,0.13)" : "rgba(140,46,46,0.18)";
  const lbl = (s: string) => s === "ok" ? "Baik" : s === "warn" ? "Perhatian" : "Kritis";

  return (
    <div className="bg-card border border-border rounded-sm p-4 mb-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield size={13} style={{ color: "#c4824a" }} />
          <span
            className="text-xs uppercase tracking-widest font-semibold"
            style={{ fontFamily: "'Barlow Condensed', sans-serif", color: "#dce3ec", letterSpacing: "0.12em" }}
          >
            Kesehatan Domain — {DOMAIN.name}
          </span>
        </div>
        <span className="text-xs font-mono text-muted-foreground">Diperbarui 2 mnt lalu</span>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {/* Bounce rate */}
        <div className="rounded-sm p-3" style={{ backgroundColor: bg(bounceStatus), border: `1px solid ${col(bounceStatus)}22` }}>
          <div className="text-xs font-mono mb-1" style={{ color: "#6a82a0" }}>TINGKAT BOUNCE</div>
          <div className="font-mono tabular-nums text-2xl font-semibold" style={{ color: col(bounceStatus) }}>
            {DOMAIN.bounceRate}%
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="flex items-center gap-1 text-xs font-mono" style={{ color: col(bounceStatus) }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: col(bounceStatus) }} />
              {lbl(bounceStatus)}
            </span>
            <span className="text-xs font-mono text-muted-foreground">ambang 2%</span>
          </div>
        </div>

        {/* Complaint rate */}
        <div className="rounded-sm p-3" style={{ backgroundColor: bg(complaintStatus), border: `1px solid ${col(complaintStatus)}22` }}>
          <div className="text-xs font-mono mb-1" style={{ color: "#6a82a0" }}>TINGKAT KELUHAN</div>
          <div className="font-mono tabular-nums text-2xl font-semibold" style={{ color: col(complaintStatus) }}>
            {DOMAIN.complaintRate}%
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="flex items-center gap-1 text-xs font-mono" style={{ color: col(complaintStatus) }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: col(complaintStatus) }} />
              {lbl(complaintStatus)}
            </span>
            <span className="text-xs font-mono text-muted-foreground">ambang 0.1%</span>
          </div>
        </div>

        {/* Warmup stage */}
        <div className="rounded-sm p-3" style={{ backgroundColor: "rgba(196,130,74,0.1)", border: "1px solid rgba(196,130,74,0.2)" }}>
          <div className="text-xs font-mono mb-1" style={{ color: "#6a82a0" }}>TAHAP PEMANASAN</div>
          <div className="flex items-baseline gap-1">
            <span className="font-mono tabular-nums text-2xl font-semibold" style={{ color: "#c4824a" }}>
              {DOMAIN.warmupStage}
            </span>
            <span className="text-sm font-mono text-muted-foreground">/ {DOMAIN.warmupTotal}</span>
          </div>
          <div className="flex gap-1 mt-2">
            {Array.from({ length: DOMAIN.warmupTotal }).map((_, i) => (
              <div
                key={i}
                className="flex-1 h-1.5 rounded-sm"
                style={{ backgroundColor: i < DOMAIN.warmupStage ? "#c4824a" : "rgba(196,130,74,0.18)" }}
              />
            ))}
          </div>
        </div>

        {/* Sent today */}
        <div className="rounded-sm p-3" style={{ backgroundColor: "rgba(100,140,180,0.07)", border: "1px solid rgba(100,140,180,0.12)" }}>
          <div className="text-xs font-mono mb-1" style={{ color: "#6a82a0" }}>KIRIM HARI INI</div>
          <div className="flex items-baseline gap-1">
            <span className="font-mono tabular-nums text-2xl font-semibold text-foreground">
              {DOMAIN.sentToday}
            </span>
            <span className="text-sm font-mono text-muted-foreground">/ {DOMAIN.dailyLimit}</span>
          </div>
          <div className="mt-2">
            <div className="h-1.5 rounded-sm overflow-hidden" style={{ backgroundColor: "rgba(100,140,180,0.15)" }}>
              <div
                className="h-full rounded-sm"
                style={{ width: `${sentPct}%`, backgroundColor: sentPct > 80 ? "#d4a040" : "#8da0b8" }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-xs font-mono text-muted-foreground">{DAILY_REMAINING.toLocaleString("id-ID")} tersisa</span>
              <span className="text-xs font-mono text-muted-foreground">{sentPct.toFixed(0)}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function DashboardScreen({ onNavigate }: { onNavigate: (s: Screen) => void }) {
  const contactTotal = CONTACT_DISTRIBUTION.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="p-6">
      <DomainHealthPanel />

      <div className="grid grid-cols-3 gap-5">
        {/* Recent campaigns */}
        <div className="col-span-2 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <SectionTitle label="Kampanye Terakhir" />
            <button
              onClick={() => onNavigate("builder")}
              className="text-xs font-mono border border-border rounded-sm px-2.5 py-1 transition-colors hover:text-foreground"
              style={{ color: "#8da0b8" }}
            >
              + Buat Kampanye
            </button>
          </div>
          <div className="bg-card border border-border rounded-sm overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <Th>ID</Th><Th>Kampanye</Th><Th>Status</Th>
                  <Th align="right">Penerima</Th><Th align="right">Dibuka</Th>
                  <Th align="right">Diklik</Th><Th align="right">Bounce</Th><Th>Tanggal</Th>
                </tr>
              </thead>
              <tbody>
                {CAMPAIGNS.map((c) => {
                  const hasData = c.recipients > 0;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => hasData && onNavigate("report")}
                      className={`border-b border-border last:border-0 transition-colors ${hasData ? "hover:bg-secondary/20 cursor-pointer" : "cursor-default"}`}
                    >
                      <td className="px-3 py-2 font-mono text-muted-foreground">{c.id}</td>
                      <td className="px-3 py-2 font-medium text-foreground max-w-[180px] truncate">{c.name}</td>
                      <td className="px-3 py-2"><StatusBadge status={c.status} /></td>
                      <td className="px-3 py-2 font-mono tabular-nums text-right text-foreground">
                        {hasData ? c.recipients.toLocaleString("id-ID") : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums text-right" style={{ color: hasData ? "#5cc9a0" : undefined }}>
                        {hasData ? `${((c.opened / c.recipients) * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums text-right" style={{ color: hasData ? "#c4824a" : undefined }}>
                        {hasData ? `${((c.clicked / c.recipients) * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums text-right" style={{ color: hasData && c.bounced > 0 ? "#d4a040" : undefined }}>
                        {hasData ? `${((c.bounced / c.recipients) * 100).toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">{c.date}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Contact distribution */}
        <div>
          <SectionTitle label="Distribusi Kontak" />
          <div className="space-y-2">
            {CONTACT_DISTRIBUTION.map((s) => (
              <div
                key={s.label}
                className="bg-card border border-border rounded-sm p-3"
                style={{ borderLeftWidth: "3px", borderLeftColor: s.color }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground">{s.label}</span>
                  <span className="font-mono tabular-nums text-lg font-semibold" style={{ color: s.color }}>
                    {s.count.toLocaleString("id-ID")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{s.sub}</p>
              </div>
            ))}

            <div className="bg-card border border-border rounded-sm p-3 mt-1">
              <div className="text-xs font-mono text-muted-foreground mb-2">KOMPOSISI</div>
              <div className="flex h-2 rounded-sm overflow-hidden gap-px">
                {CONTACT_DISTRIBUTION.map((s) => (
                  <div key={s.label} style={{ flex: s.count, backgroundColor: s.bar }} />
                ))}
              </div>
              <div className="flex justify-between mt-1.5 text-xs font-mono text-muted-foreground">
                <span>{((CONTACT_DISTRIBUTION[0].count / contactTotal) * 100).toFixed(1)}% aktif</span>
                <span>{contactTotal.toLocaleString("id-ID")} total</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Import ───────────────────────────────────────────────────────────────────

function ImportScreen() {
  const [step, setStep] = useState<ImportStep>(1);
  const [fileUploaded, setFileUploaded] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({
    email: "email_bisnis",
    company: "nama_perusahaan",
    industry: "",
    city: "",
  });

  const mapFields = [
    { field: "Email *",           key: "email",    required: true  },
    { field: "Nama Perusahaan *", key: "company",  required: true  },
    { field: "Industri",          key: "industry", required: false },
    { field: "Kota",              key: "city",     required: false },
  ];

  const mappingComplete = mapFields.every((f) => !f.required || Boolean(mapping[f.key]));

  return (
    <div className="p-6 max-w-4xl">
      <StepBar steps={["Unggah Berkas", "Pemetaan Kolom", "Validasi & Konfirmasi"]} current={step} />

      {/* ── Step 1 ── */}
      {step === 1 && (
        <div className="space-y-4">
          <SectionTitle label="Unggah Berkas" sub="Unggah file CSV atau file terenkripsi .enc berisi daftar kontak bisnis." />

          <button
            type="button"
            className="w-full border-2 border-dashed rounded-sm p-12 text-center cursor-pointer transition-colors"
            style={{
              borderColor: fileUploaded ? "#2b7a5a" : "rgba(100,140,180,0.22)",
              backgroundColor: fileUploaded ? "rgba(43,122,90,0.08)" : "rgba(100,140,180,0.03)",
            }}
            onClick={() => setFileUploaded((v) => !v)}
          >
            {fileUploaded ? (
              <div className="flex flex-col items-center gap-2">
                <CheckCircle size={32} style={{ color: "#5cc9a0" }} />
                <span className="font-mono text-sm" style={{ color: "#5cc9a0" }}>kontak_manufaktur_sep2024.csv</span>
                <span className="text-xs font-mono text-muted-foreground">{(1342).toLocaleString("id-ID")} baris terdeteksi · 4.2 KB</span>
                <span className="text-xs font-mono text-muted-foreground">klik untuk ganti file</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload size={28} className="text-muted-foreground" />
                <span className="text-sm font-mono text-muted-foreground">Seret & letakkan file CSV atau .enc di sini</span>
                <span className="text-xs text-muted-foreground">atau klik untuk memilih file</span>
              </div>
            )}
          </button>

          <div className="bg-card border border-border rounded-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <Lock size={12} style={{ color: "#c4824a" }} />
              <span className="text-xs font-mono font-medium text-foreground">File Terenkripsi (.enc)</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Jika file Anda dienkripsi, masukkan password dekripsi sebelum impor.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                placeholder="Password dekripsi..."
                className="flex-1 bg-secondary border border-border rounded-sm px-3 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground outline-none"
                style={{ caretColor: "#c4824a" }}
              />
              <button className="px-3 py-1.5 text-xs font-mono border border-border rounded-sm text-muted-foreground transition-colors hover:text-foreground">
                Verifikasi
              </button>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => fileUploaded && setStep(2)}
              disabled={!fileUploaded}
              className="px-4 py-2 text-xs font-mono rounded-sm flex items-center gap-2 transition-all"
              style={{
                backgroundColor: fileUploaded ? "#c4824a" : "rgba(100,140,180,0.1)",
                color: fileUploaded ? "#fff" : "#6a82a0",
                cursor: fileUploaded ? "pointer" : "not-allowed",
              }}
            >
              Lanjut: Pemetaan Kolom <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2 ── */}
      {step === 2 && (
        <div className="space-y-4">
          <SectionTitle label="Pemetaan Kolom" sub="Cocokkan kolom dari file Anda. Pratinjau 5 baris pertama ditampilkan." />

          <div className="bg-card border border-border rounded-sm overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {CSV_COLS.map((c) => (
                    <th key={c} className="px-3 py-2 text-left font-mono text-muted-foreground" style={{ backgroundColor: "rgba(100,140,180,0.06)" }}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CSV_ROWS.map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {row.map((cell, j) => (
                      <td key={j} className="px-3 py-2 font-mono text-foreground">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-card border border-border rounded-sm p-4">
            <div className="text-xs font-mono font-medium text-muted-foreground mb-3">PEMETAAN FIELD</div>
            <div className="grid grid-cols-2 gap-3">
              {mapFields.map(({ field, key, required }) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-36 text-xs font-mono text-foreground flex-shrink-0">{field}</span>
                  <span className="text-muted-foreground text-xs">→</span>
                  <select
                    className="flex-1 bg-secondary border border-border rounded-sm px-2 py-1 text-xs font-mono text-foreground outline-none"
                    value={mapping[key] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value }))}
                  >
                    <option value="">— tidak dipetakan —</option>
                    {CSV_COLS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {required && !mapping[key] && <AlertCircle size={12} style={{ color: "#d4a040", flexShrink: 0 }} />}
                  {required && mapping[key]  && <Check       size={12} style={{ color: "#5cc9a0", flexShrink: 0 }} />}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="px-4 py-2 text-xs font-mono border border-border rounded-sm text-muted-foreground flex items-center gap-2 transition-colors hover:text-foreground">
              <ArrowLeft size={13} /> Kembali
            </button>
            <button
              onClick={() => mappingComplete && setStep(3)}
              disabled={!mappingComplete}
              title={mappingComplete ? undefined : "Petakan semua field wajib terlebih dahulu"}
              className="px-4 py-2 text-xs font-mono rounded-sm flex items-center gap-2 transition-all"
              style={{
                backgroundColor: mappingComplete ? "#c4824a" : "rgba(100,140,180,0.1)",
                color: mappingComplete ? "#fff" : "#6a82a0",
                cursor: mappingComplete ? "pointer" : "not-allowed",
              }}
            >
              Lanjut: Validasi <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3 ── */}
      {step === 3 && (
        <div className="space-y-4">
          <SectionTitle label="Ringkasan Validasi" sub="Periksa hasil validasi sebelum konfirmasi impor." />

          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Diterima",    count: 1247, color: "#5cc9a0", bg: "rgba(43,122,90,0.15)",    desc: "Siap diimpor"              },
              { label: "Ditolak",     count: 23,   color: "#e05252", bg: "rgba(140,46,46,0.15)",    desc: "Format tidak valid"        },
              { label: "Duplikat",    count: 54,   color: "#d4a040", bg: "rgba(180,120,30,0.15)",   desc: "Sudah ada di sistem"       },
              { label: "Dikarantina", count: 18,   color: "#8da0b8", bg: "rgba(106,130,160,0.1)",   desc: "Sumber belum diverifikasi" },
            ].map((s) => (
              <div key={s.label} className="rounded-sm p-3" style={{ backgroundColor: s.bg, border: `1px solid ${s.color}25` }}>
                <div className="text-xs font-mono mb-1" style={{ color: "#6a82a0" }}>{s.label}</div>
                <div className="font-mono tabular-nums text-2xl font-semibold" style={{ color: s.color }}>
                  {s.count.toLocaleString("id-ID")}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.desc}</div>
              </div>
            ))}
          </div>

          <div className="bg-card border border-border rounded-sm p-4 space-y-2.5">
            <div className="text-xs font-mono font-medium text-muted-foreground mb-1">CATATAN VALIDASI</div>
            {[
              { type: "warn",  text: "18 kontak dikarantina – sumber izin “LinkedIn scraping” memiliki risiko keluhan lebih tinggi" },
              { type: "info",  text: "54 alamat email duplikat tidak akan diimpor" },
              { type: "error", text: "23 baris ditolak: 11 format email tidak valid, 12 nama perusahaan kosong" },
            ].map((n, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                {n.type === "warn"  && <AlertTriangle size={12} style={{ color: "#d4a040", flexShrink: 0, marginTop: 1 }} />}
                {n.type === "info"  && <AlertCircle   size={12} style={{ color: "#8da0b8", flexShrink: 0, marginTop: 1 }} />}
                {n.type === "error" && <XCircle        size={12} style={{ color: "#e05252", flexShrink: 0, marginTop: 1 }} />}
                <span style={{ color: n.type === "warn" ? "#d4a040" : n.type === "error" ? "#e05252" : "#8da0b8" }}>{n.text}</span>
              </div>
            ))}
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(2)} className="px-4 py-2 text-xs font-mono border border-border rounded-sm text-muted-foreground flex items-center gap-2 transition-colors hover:text-foreground">
              <ArrowLeft size={13} /> Kembali
            </button>
            <div className="flex gap-2">
              <button className="px-3 py-2 text-xs font-mono border border-border rounded-sm text-muted-foreground flex items-center gap-1.5 transition-colors hover:text-foreground">
                <Download size={12} /> Unduh Laporan Error
              </button>
              <button
                className="px-4 py-2 text-xs font-mono rounded-sm flex items-center gap-2"
                style={{ backgroundColor: "#2b7a5a", color: "#fff" }}
              >
                <Check size={13} /> Konfirmasi Impor 1.247 Kontak
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

function ContactsScreen() {
  const [statusFilter, setStatusFilter] = useState("semua");
  const [search, setSearch] = useState("");

  const filtered = CONTACTS.filter((c) => {
    if (statusFilter !== "semua" && c.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!c.company.toLowerCase().includes(q) && !c.email.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <SectionTitle label="Daftar Kontak" />
          <p className="text-xs font-mono text-muted-foreground -mt-3">
            {CONTACTS.filter((c) => c.status === "aktif").length} aktif ·{" "}
            {CONTACTS.filter((c) => c.status === "karantina").length} karantina ·{" "}
            {CONTACTS.filter((c) => c.status === "diblokir").length} diblokir
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Cari perusahaan atau email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-card border border-border rounded-sm pl-7 pr-3 py-1.5 text-xs font-mono text-foreground placeholder:text-muted-foreground outline-none w-64"
              style={{ caretColor: "#c4824a" }}
            />
          </div>
          <div className="flex gap-1">
            {["semua", "aktif", "karantina", "diblokir"].map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className="px-2.5 py-1.5 text-xs font-mono rounded-sm capitalize transition-all"
                style={{
                  backgroundColor: statusFilter === f ? "#c4824a" : "rgba(100,140,180,0.07)",
                  color: statusFilter === f ? "#fff" : "#8da0b8",
                  border: `1px solid ${statusFilter === f ? "#c4824a" : "rgba(100,140,180,0.12)"}`,
                }}
              >
                {f === "semua" ? "Semua" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <Th>Perusahaan</Th><Th>Email</Th><Th>Sumber Izin</Th><Th>Status</Th><Th>Tanggal Impor</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr
                key={c.id}
                className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors"
                style={{
                  backgroundColor: c.status === "karantina" ? "rgba(180,120,30,0.05)"  : c.status === "diblokir" ? "rgba(140,46,46,0.05)" : undefined,
                  borderLeft:      c.status === "karantina" ? "2px solid rgba(212,160,64,0.45)" : c.status === "diblokir" ? "2px solid rgba(224,82,82,0.45)" : "2px solid transparent",
                }}
              >
                <td className="px-3 py-2 font-medium text-foreground">{c.company}</td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{c.email}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {c.consent === "LinkedIn" ? (
                    <span className="flex items-center gap-1">
                      <AlertTriangle size={10} style={{ color: "#d4a040" }} />
                      {c.consent}
                    </span>
                  ) : c.consent}
                </td>
                <td className="px-3 py-2"><StatusBadge status={c.status} /></td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{c.date}</td>
                <td className="px-3 py-2">
                  <button className="text-muted-foreground hover:text-foreground transition-colors">
                    <Eye size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-10 text-center text-xs font-mono text-muted-foreground">
            Tidak ada kontak yang cocok.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Campaign Builder ─────────────────────────────────────────────────────────

function CampaignBuilderScreen() {
  const [step, setStep] = useState<BuilderStep>(1);
  const [selectedSegment, setSelectedSegment] = useState("manufaktur");
  const [subject, setSubject] = useState("Penawaran Solusi Efisiensi Produksi untuk {{nama_perusahaan}}");
  const [body, setBody] = useState(
    "Yth. Tim Pengadaan {{nama_perusahaan}},\n\nKami dari Nusantara Solutions ingin memperkenalkan solusi manajemen produksi terbaru yang telah membantu lebih dari 50 perusahaan manufaktur di Indonesia meningkatkan efisiensi hingga 30%.\n\nApakah Anda bersedia untuk jadwal demo 20 menit minggu ini?\n\nHormat kami,\nTim Penjualan Nusantara Solutions\nJl. Sudirman No. 45, Jakarta Selatan 12190"
  );

  const segment = SEGMENTS.find((s) => s.id === selectedSegment);
  const isBlocked = (segment?.count ?? 0) > DAILY_REMAINING;
  const subLen = subject.length;

  const compliance = [
    { label: "Panjang subject ≤ 60 karakter",    ok: subLen <= 60,  detail: `${subLen} karakter` },
    { label: "Tautan berhenti berlangganan ada",  ok: true,          detail: "Ditambahkan otomatis" },
    { label: "Alamat fisik pengirim ada",         ok: true,          detail: "Jl. Sudirman No. 45, Jakarta" },
    { label: "Volume dalam batas pemanasan",      ok: !isBlocked,    detail: isBlocked ? `${segment?.count.toLocaleString("id-ID")} melebihi sisa ${DAILY_REMAINING.toLocaleString("id-ID")}` : `${segment?.count.toLocaleString("id-ID")} ≤ ${DAILY_REMAINING.toLocaleString("id-ID")} tersisa` },
    { label: "Sumber izin terverifikasi",         ok: selectedSegment !== "all", detail: selectedSegment === "all" ? "Ada kontak dari LinkedIn" : "Semua dari sumber terverifikasi" },
  ];

  return (
    <div className="p-6 max-w-5xl">
      <StepBar steps={["Pilih Segmen", "Tulis Pesan", "Tinjau & Kirim"]} current={step} />

      {/* ── Step 1 ── */}
      {step === 1 && (
        <div className="space-y-4">
          <SectionTitle label="Pilih Segmen Penerima" sub="Pilih kelompok penerima. Jumlah akan disesuaikan dengan batas kirim harian aktif." />

          <div className="bg-card border border-border rounded-sm p-3 flex items-center gap-2 mb-2">
            <Shield size={12} style={{ color: "#c4824a", flexShrink: 0 }} />
            <span className="text-xs font-mono text-muted-foreground">
              Batas pengiriman hari ini:{" "}
              <span className="text-foreground">{DAILY_REMAINING.toLocaleString("id-ID")} email tersisa</span>
              {" "}· Tahap pemanasan {DOMAIN.warmupStage}/{DOMAIN.warmupTotal}
            </span>
          </div>

          <div className="space-y-1.5">
            {SEGMENTS.map((seg) => {
              const selected = selectedSegment === seg.id;
              const over = seg.count > DAILY_REMAINING;
              return (
                <button
                  key={seg.id}
                  type="button"
                  onClick={() => setSelectedSegment(seg.id)}
                  aria-pressed={selected}
                  className="w-full text-left bg-card border rounded-sm p-3 cursor-pointer flex items-center justify-between transition-all"
                  style={{
                    borderColor: selected ? "#c4824a" : "rgba(100,140,180,0.12)",
                    backgroundColor: selected ? "rgba(196,130,74,0.07)" : undefined,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0"
                      style={{ borderColor: selected ? "#c4824a" : "rgba(100,140,180,0.3)", backgroundColor: selected ? "#c4824a" : "transparent" }}
                    >
                      {selected && <Check size={9} color="#fff" />}
                    </div>
                    <span className="text-xs text-foreground">{seg.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {over && (
                      <span className="text-xs font-mono flex items-center gap-1" style={{ color: "#e05252" }}>
                        <AlertTriangle size={11} /> Melebihi batas harian
                      </span>
                    )}
                    <span className="font-mono tabular-nums text-sm font-semibold" style={{ color: over ? "#e05252" : "#dce3ec" }}>
                      {seg.count.toLocaleString("id-ID")}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">penerima</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex justify-end">
            <button onClick={() => setStep(2)} className="px-4 py-2 text-xs font-mono rounded-sm flex items-center gap-2" style={{ backgroundColor: "#c4824a", color: "#fff" }}>
              Lanjut: Tulis Pesan <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2 ── */}
      {step === 2 && (
        <div className="space-y-4">
          <SectionTitle label="Tulis Pesan" sub="Gunakan variabel untuk personalisasi. Pratinjau dirender dari kontak pertama." />
          <div className="grid grid-cols-2 gap-5">
            {/* Editor */}
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-xs font-mono text-muted-foreground mr-1">Variabel:</span>
                {["{{nama_perusahaan}}", "{{nama_kontak}}", "{{industri}}", "{{kota}}"].map((v) => (
                  <button
                    key={v}
                    onClick={() => setBody((b) => b + " " + v)}
                    className="px-1.5 py-0.5 text-xs font-mono rounded-sm transition-colors"
                    style={{ backgroundColor: "rgba(196,130,74,0.13)", color: "#c4824a", border: "1px solid rgba(196,130,74,0.28)" }}
                  >
                    {v}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-xs font-mono mb-1" style={{ color: "#6a82a0" }}>
                  SUBJECT{" "}
                  <span className="tabular-nums ml-1" style={{ color: subLen > 60 ? "#e05252" : "#6a82a0" }}>{subLen}/60</span>
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full bg-card border rounded-sm px-3 py-2 text-xs font-mono text-foreground outline-none"
                  style={{ borderColor: subLen > 60 ? "#8c2e2e" : "rgba(100,140,180,0.12)", caretColor: "#c4824a" }}
                />
              </div>

              <div>
                <label className="block text-xs font-mono mb-1" style={{ color: "#6a82a0" }}>ISI PESAN</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={12}
                  className="w-full bg-card border border-border rounded-sm px-3 py-2 text-xs font-mono text-foreground outline-none resize-none"
                  style={{ caretColor: "#c4824a" }}
                />
              </div>
            </div>

            {/* Preview */}
            <div>
              <div className="text-xs font-mono mb-1" style={{ color: "#6a82a0" }}>PRATINJAU LANGSUNG</div>
              <div className="bg-secondary/20 border border-border rounded-sm overflow-hidden">
                <div className="border-b border-border px-4 py-2.5 space-y-1" style={{ backgroundColor: "rgba(100,140,180,0.05)" }}>
                  {[
                    ["Dari", "Nusantara Sales <blast@nusantarasales.id>"],
                    ["Ke", "procurement@astra.co.id"],
                    ["Subject", subject.replace(/{{nama_perusahaan}}/g, "PT Astra International")],
                  ].map(([lbl, val]) => (
                    <div key={lbl} className="flex items-start gap-2">
                      <span className="text-xs font-mono text-muted-foreground w-14 flex-shrink-0">{lbl}:</span>
                      <span className="text-xs font-mono text-foreground break-all">{val}</span>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-3">
                  <pre className="text-xs font-mono text-foreground whitespace-pre-wrap leading-relaxed" style={{ fontFamily: "inherit" }}>
                    {body
                      .replace(/{{nama_perusahaan}}/g, "PT Astra International")
                      .replace(/{{nama_kontak}}/g, "Bapak/Ibu")
                      .replace(/{{industri}}/g, "Manufaktur")
                      .replace(/{{kota}}/g, "Surabaya")}
                  </pre>
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-xs text-muted-foreground">
                      Tidak ingin menerima email ini?{" "}
                      <span style={{ color: "#c4824a", textDecoration: "underline" }}>Berhenti berlangganan</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">Nusantara Solutions · Jl. Sudirman No. 45, Jakarta Selatan 12190</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="px-4 py-2 text-xs font-mono border border-border rounded-sm text-muted-foreground flex items-center gap-2 hover:text-foreground transition-colors">
              <ArrowLeft size={13} /> Kembali
            </button>
            <button onClick={() => setStep(3)} className="px-4 py-2 text-xs font-mono rounded-sm flex items-center gap-2" style={{ backgroundColor: "#c4824a", color: "#fff" }}>
              Tinjau Kampanye <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3 ── */}
      {step === 3 && (
        <div className="space-y-4">
          <SectionTitle label="Tinjau & Kirim" sub="Kampanye hanya dapat dikirim jika semua syarat kepatuhan terpenuhi." />

          {isBlocked && (
            <div className="rounded-sm p-4 flex items-start gap-3 border" style={{ backgroundColor: "rgba(140,46,46,0.14)", borderColor: "rgba(224,82,82,0.28)" }}>
              <XCircle size={16} style={{ color: "#e05252", flexShrink: 0, marginTop: 1 }} />
              <div>
                <p
                  className="text-sm font-semibold uppercase tracking-wide mb-1"
                  style={{ fontFamily: "'Barlow Condensed', sans-serif", color: "#e05252", letterSpacing: "0.08em" }}
                >
                  Kampanye Diblokir — Melebihi Batas Pemanasan
                </p>
                <p className="text-xs text-muted-foreground">
                  Segmen yang dipilih ({segment?.count.toLocaleString("id-ID")} penerima) melebihi sisa kuota harian ({DAILY_REMAINING.toLocaleString("id-ID")} email).
                  Mengirim melebihi batas ini berisiko merusak reputasi domain. Pilih segmen lebih kecil atau tunggu hari berikutnya.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-sm p-4">
              <div className="text-xs font-mono font-medium text-muted-foreground mb-3">RINGKASAN KAMPANYE</div>
              {[
                { label: "Segmen",    value: segment?.label ?? "—" },
                { label: "Penerima", value: `${segment?.count.toLocaleString("id-ID")} kontak` },
                { label: "Subject",  value: subject.length > 42 ? subject.slice(0, 42) + "…" : subject },
                { label: "Pengirim", value: "blast@nusantarasales.id" },
                { label: "Domain",   value: DOMAIN.name },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between py-1.5 border-b border-border last:border-0 text-xs">
                  <span className="font-mono text-muted-foreground">{label}</span>
                  <span className="font-mono text-foreground text-right max-w-[200px] truncate">{value}</span>
                </div>
              ))}
            </div>

            <div className="bg-card border border-border rounded-sm p-4">
              <div className="text-xs font-mono font-medium text-muted-foreground mb-3">DAFTAR KEPATUHAN</div>
              <div className="space-y-2.5">
                {compliance.map((item) => (
                  <div key={item.label} className="flex items-start gap-2">
                    {item.ok
                      ? <CheckCircle size={13} style={{ color: "#5cc9a0", flexShrink: 0, marginTop: 1 }} />
                      : <XCircle     size={13} style={{ color: "#e05252", flexShrink: 0, marginTop: 1 }} />}
                    <div>
                      <p className="text-xs" style={{ color: item.ok ? "#dce3ec" : "#e05252" }}>{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(2)} className="px-4 py-2 text-xs font-mono border border-border rounded-sm text-muted-foreground flex items-center gap-2 hover:text-foreground transition-colors">
              <ArrowLeft size={13} /> Kembali
            </button>
            <button
              disabled={isBlocked}
              className="px-6 py-2 text-xs font-mono rounded-sm flex items-center gap-2 transition-all"
              style={{
                backgroundColor: isBlocked ? "rgba(140,46,46,0.25)" : "#2b7a5a",
                color: isBlocked ? "#e05252" : "#fff",
                cursor: isBlocked ? "not-allowed" : "pointer",
              }}
            >
              <Send size={13} />
              {isBlocked ? "Pengiriman Diblokir" : `Kirim ke ${segment?.count.toLocaleString("id-ID")} Penerima`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Report ───────────────────────────────────────────────────────────────────

function ReportScreen() {
  const maxVal = Math.max(...FUNNEL.map((f) => f.value));
  const sent = funnelValue("terkirim");
  const rate = (key: string) => `${((funnelValue(key) / sent) * 100).toFixed(1)}%`;
  const reportCampaign = CAMPAIGNS.find((c) => c.id === REPORT_CAMPAIGN_ID);

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-4">
        <SectionTitle
          label={`Laporan: ${reportCampaign?.name ?? REPORT_CAMPAIGN_ID}`}
          sub={`${REPORT_CAMPAIGN_ID} · ${reportCampaign?.date ?? "—"} · ${sent.toLocaleString("id-ID")} penerima`}
        />
        <button className="text-xs font-mono flex items-center gap-1.5 border border-border rounded-sm px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors">
          <Download size={12} /> Unduh PDF
        </button>
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Funnel + comparison */}
        <div className="col-span-2 space-y-4">
          <div className="bg-card border border-border rounded-sm p-4">
            <div className="flex items-baseline justify-between mb-4">
              <span className="text-xs font-mono font-medium text-muted-foreground">CORONG PENGIRIMAN (FUNNEL)</span>
              <span className="text-xs font-mono text-muted-foreground">% terhadap tahap sebelumnya</span>
            </div>
            <div className="space-y-2">
              {FUNNEL.map((item) => {
                const barPct = (item.value / maxVal) * 100;
                const base = item.of ? funnelValue(item.of) : 0;
                const pct = base > 0 ? ((item.value / base) * 100).toFixed(1) : null;
                return (
                  <div key={item.label} className="flex items-center gap-3">
                    <span className="w-36 text-right text-xs font-mono text-muted-foreground flex-shrink-0">{item.label}</span>
                    <div className="flex-1 h-7 flex items-center">
                      <div
                        className="h-full rounded-sm flex items-center justify-end pr-2"
                        style={{ width: `${barPct}%`, backgroundColor: item.color, minWidth: "2rem" }}
                      >
                        <span className="text-xs font-mono font-medium text-white tabular-nums">
                          {item.value.toLocaleString("id-ID")}
                        </span>
                      </div>
                    </div>
                    <span className="w-32 text-right text-xs font-mono text-muted-foreground flex-shrink-0">
                      {pct === null ? "—" : item.ofLabel ? `${pct}% ${item.ofLabel}` : `↓ ${pct}%`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-card border border-border rounded-sm p-4">
            <div className="text-xs font-mono font-medium text-muted-foreground mb-4">PERBANDINGAN KAMPANYE (%)</div>
            <ResponsiveContainer width="100%" height={176}>
              <BarChart data={COMPARISON_DATA} barGap={2} barCategoryGap={20} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", fill: "#6a82a0" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fontFamily: "JetBrains Mono, monospace", fill: "#6a82a0" }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip
                  contentStyle={{ backgroundColor: "#141e2e", border: "1px solid rgba(100,140,180,0.14)", borderRadius: "2px", fontSize: "11px", fontFamily: "JetBrains Mono, monospace" }}
                  labelStyle={{ color: "#dce3ec" }}
                  itemStyle={{ color: "#8da0b8" }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={22}
                  iconSize={8}
                  wrapperStyle={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: "#8da0b8" }}
                />
                <Bar dataKey="buka"   name="Dibuka"  fill="#2b7a5a" />
                <Bar dataKey="klik"   name="Diklik"  fill="#c4824a" />
                <Bar dataKey="bounce" name="Bounced" fill="#8c2e2e" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right panel */}
        <div className="space-y-3">
          <div className="bg-card border border-border rounded-sm p-4">
            <div className="text-xs font-mono font-medium text-muted-foreground mb-3">DAMPAK KESEHATAN DOMAIN</div>
            {[
              { label: "Bounce Rate",      before: "1.6%",  after: "1.8%", delta: "+0.2%",  warn: true  },
              { label: "Complaint Rate",   before: "0.03%", after: "0.04%", delta: "+0.01%", warn: false },
              { label: "Reputasi Domain",  before: "Baik",  after: "Baik", delta: "Stabil", warn: false },
            ].map((item) => (
              <div key={item.label} className="mb-3 pb-3 border-b border-border last:border-0 last:mb-0 last:pb-0">
                <div className="flex justify-between mb-0.5">
                  <span className="text-xs font-mono text-muted-foreground">{item.label}</span>
                  <span className="text-xs font-mono tabular-nums" style={{ color: item.warn ? "#d4a040" : "#5cc9a0" }}>{item.delta}</span>
                </div>
                <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
                  <span className="text-muted-foreground">{item.before}</span>
                  <span className="text-muted-foreground">→</span>
                  <span style={{ color: item.warn ? "#d4a040" : "#dce3ec" }}>{item.after}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-card border border-border rounded-sm p-4">
            <div className="mb-3">
              <div className="text-xs font-mono font-medium text-muted-foreground">METRIK RINGKAS</div>
              <div className="text-xs font-mono text-muted-foreground">% terhadap total terkirim</div>
            </div>
            {[
              { label: "Terkirim",       value: sent.toLocaleString("id-ID"), color: "#dce3ec" },
              { label: "Tingkat Buka",   value: rate("dibuka"),               color: "#5cc9a0" },
              { label: "Tingkat Klik",   value: rate("diklik"),               color: "#c4824a" },
              { label: "Tingkat Bounce", value: rate("bounced"),              color: "#d4a040" },
              { label: "Berhenti Lgg.",  value: rate("unsub"),                color: "#e05252" },
            ].map((m) => (
              <div key={m.label} className="flex justify-between py-1.5 border-b border-border last:border-0">
                <span className="text-xs font-mono text-muted-foreground">{m.label}</span>
                <span className="text-xs font-mono tabular-nums font-semibold" style={{ color: m.color }}>{m.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Suppression ──────────────────────────────────────────────────────────────

function SuppressionScreen() {
  const typeColor: Record<string, string> = {
    Keluhan: "#e05252",
    "Hard Bounce": "#d4a040",
    Manual: "#8da0b8",
    Unsubscribe: "#8da0b8",
  };
  const typeBg: Record<string, string> = {
    Keluhan: "rgba(140,46,46,0.2)",
    "Hard Bounce": "rgba(180,120,30,0.15)",
    Manual: "rgba(100,130,160,0.1)",
    Unsubscribe: "rgba(100,130,160,0.1)",
  };

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <SectionTitle label="Daftar Suppres" />
          <p className="text-xs font-mono text-muted-foreground -mt-3">
            {SUPPRESSION.length} entri · Hanya baca · Tidak dapat diubah atau dihapus
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="px-3 py-1.5 rounded-sm text-xs font-mono flex items-center gap-1.5"
            style={{ backgroundColor: "rgba(140,46,46,0.15)", color: "#e05252", border: "1px solid rgba(224,82,82,0.2)" }}
          >
            <Lock size={11} /> Daftar Permanen
          </div>
          <button className="text-xs font-mono flex items-center gap-1.5 border border-border rounded-sm px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors">
            <Download size={12} /> Export CSV
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-sm p-3 mb-4 flex items-start gap-2">
        <Shield size={13} style={{ color: "#c4824a", flexShrink: 0, marginTop: 1 }} />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Email dalam daftar ini{" "}
          <strong className="text-foreground">tidak akan pernah menerima kampanye dari domain Anda</strong>,
          terlepas dari segmen yang dipilih. Daftar ini dikelola otomatis oleh sistem untuk melindungi reputasi domain.
        </p>
      </div>

      <div className="bg-card border border-border rounded-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <Th>Email</Th><Th>Alasan</Th><Th>Tipe</Th><Th>Tanggal Ditambahkan</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {SUPPRESSION.map((item, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-mono text-muted-foreground">{item.email}</td>
                <td className="px-3 py-2 text-muted-foreground">{item.reason}</td>
                <td className="px-3 py-2">
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 text-xs font-mono rounded-sm"
                    style={{ backgroundColor: typeBg[item.type] ?? typeBg.Manual, color: typeColor[item.type] ?? typeColor.Manual }}
                  >
                    {item.type}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono tabular-nums text-muted-foreground">{item.date}</td>
                <td className="px-3 py-2">
                  <Lock size={11} className="text-muted-foreground opacity-50" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function Sidebar({ screen, onNavigate }: { screen: Screen; onNavigate: (s: Screen) => void }) {
  const nav: { id: Screen; icon: React.ElementType; label: string }[] = [
    { id: "dashboard",   icon: Activity,  label: "Dasbor"          },
    { id: "import",      icon: Upload,    label: "Impor Kontak"     },
    { id: "contacts",    icon: Users,     label: "Daftar Kontak"    },
    { id: "builder",     icon: Send,      label: "Buat Kampanye"    },
    { id: "report",      icon: BarChart2, label: "Laporan"          },
    { id: "suppression", icon: Database,  label: "Daftar Suppres"   },
  ];

  const bounceOk    = DOMAIN.bounceRate    < 2;
  const complaintOk = DOMAIN.complaintRate < 0.1;
  const overall     = bounceOk && complaintOk;

  return (
    <div className="w-52 flex flex-col border-r border-border flex-shrink-0" style={{ backgroundColor: "#0a1018" }}>
      {/* Wordmark */}
      <div className="px-4 py-4 border-b border-border flex items-center gap-2">
        <div
          className="w-6 h-6 rounded-sm flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: "#c4824a" }}
        >
          <Mail size={13} color="#fff" />
        </div>
        <span
          className="uppercase tracking-widest font-bold text-xs"
          style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.12em", color: "#dce3ec", fontSize: "13px" }}
        >
          Marketing Blast
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2">
        {nav.map(({ id, icon: Icon, label }) => {
          const active = screen === id;
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-left transition-all"
              style={{
                backgroundColor: active ? "rgba(196,130,74,0.11)" : "transparent",
                color: active ? "#c4824a" : "#6a82a0",
                borderLeft: `2px solid ${active ? "#c4824a" : "transparent"}`,
              }}
            >
              <Icon size={13} />
              <span className="text-xs font-mono">{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Domain health mini */}
      <div className="px-4 py-3.5 border-t border-border">
        <div className="flex items-center gap-1.5 mb-2">
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: overall ? "#5cc9a0" : "#d4a040" }}
          />
          <span className="text-xs font-mono text-muted-foreground truncate" title={DOMAIN.name}>{DOMAIN.name}</span>
        </div>
        <div className="space-y-1">
          {[
            { label: "Bounce",     val: `${DOMAIN.bounceRate}%`,    ok: bounceOk    },
            { label: "Keluhan",    val: `${DOMAIN.complaintRate}%`, ok: complaintOk },
            { label: "Pemanasan", val: `${DOMAIN.warmupStage}/${DOMAIN.warmupTotal}`, ok: true, copper: true },
          ].map((m) => (
            <div key={m.label} className="flex justify-between text-xs font-mono">
              <span className="text-muted-foreground">{m.label}</span>
              <span className="tabular-nums" style={{ color: m.copper ? "#c4824a" : m.ok ? "#5cc9a0" : "#d4a040" }}>
                {m.val}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────────

function Header({ screen }: { screen: Screen }) {
  const titles: Record<Screen, string> = {
    dashboard:   "DASBOR",
    import:      "IMPOR KONTAK",
    contacts:    "DAFTAR KONTAK",
    builder:     "BUAT KAMPANYE",
    report:      "LAPORAN KAMPANYE",
    suppression: "DAFTAR SUPPRES",
  };

  return (
    <div
      className="h-11 border-b border-border flex items-center justify-between px-6 flex-shrink-0"
      style={{ backgroundColor: "#0a1018" }}
    >
      <span
        className="text-xs uppercase tracking-widest font-semibold"
        style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.14em", color: "#dce3ec" }}
      >
        {titles[screen]}
      </span>
      <div className="flex items-center gap-4">
        <span className="text-xs font-mono text-muted-foreground">
          {new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
        </span>
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-sm flex items-center justify-center text-xs font-mono font-semibold flex-shrink-0"
            style={{ backgroundColor: "rgba(196,130,74,0.18)", color: "#c4824a" }}
          >
            NS
          </div>
          <span className="text-xs font-mono text-muted-foreground">Nusantara Sales</span>
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState<Screen>("dashboard");

  return (
    <div
      className="flex h-screen overflow-hidden bg-background text-foreground"
      style={{ fontFamily: "'Inter', ui-sans-serif, system-ui" }}
    >
      <Sidebar screen={screen} onNavigate={setScreen} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header screen={screen} />
        <main
          className="flex-1 overflow-y-auto"
          style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(100,140,180,0.18) transparent" }}
        >
          {screen === "dashboard"   && <DashboardScreen onNavigate={setScreen} />}
          {screen === "import"      && <ImportScreen />}
          {screen === "contacts"    && <ContactsScreen />}
          {screen === "builder"     && <CampaignBuilderScreen />}
          {screen === "report"      && <ReportScreen />}
          {screen === "suppression" && <SuppressionScreen />}
        </main>
      </div>
    </div>
  );
}
