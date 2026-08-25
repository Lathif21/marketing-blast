import { useState } from "react";
import type React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  Send,
  Shield,
  XCircle,
} from "lucide-react";
import { SectionTitle } from "../components/SectionTitle";
import { StepBar } from "../components/StepBar";
import { Mono, Num, PanelLabel } from "../components/Typography";
import { DAILY_REMAINING, DOMAIN, SEGMENTS, SENDER } from "../lib/mock";
import type { BuilderStep } from "../lib/types";

const VARIABLES = ["{{nama_perusahaan}}", "{{nama_kontak}}", "{{industri}}", "{{kota}}"];

const SAMPLE = {
  company: "PT Astra International",
  contact: "Bapak/Ibu",
  industry: "Manufaktur",
  city: "Surabaya",
  email: "procurement@astra.co.id",
};

const render = (text: string) =>
  text
    .replace(/{{nama_perusahaan}}/g, SAMPLE.company)
    .replace(/{{nama_kontak}}/g, SAMPLE.contact)
    .replace(/{{industri}}/g, SAMPLE.industry)
    .replace(/{{kota}}/g, SAMPLE.city);

const DEFAULT_BODY = [
  `Yth. Tim Pengadaan {{nama_perusahaan}},`,
  ``,
  `Kami dari ${SENDER.company} ingin memperkenalkan solusi manajemen produksi terbaru yang telah membantu lebih dari 50 perusahaan manufaktur di Indonesia meningkatkan efisiensi hingga 30%.`,
  ``,
  `Apakah Anda bersedia untuk jadwal demo 20 menit minggu ini?`,
  ``,
  `Hormat kami,`,
  `Tim Penjualan ${SENDER.company}`,
  SENDER.address,
].join("\n");

export function CampaignBuilderScreen() {
  const [step, setStep] = useState<BuilderStep>(1);
  const [selectedSegment, setSelectedSegment] = useState("manufaktur");
  const [subject, setSubject] = useState(
    "Penawaran Solusi Efisiensi Produksi untuk {{nama_perusahaan}}",
  );
  const [body, setBody] = useState(DEFAULT_BODY);

  const segment = SEGMENTS.find((s) => s.id === selectedSegment);
  const recipients = segment?.count ?? 0;
  const isBlocked = recipients > DAILY_REMAINING;
  const subLen = subject.length;

  const fmt = (n: number) => n.toLocaleString("id-ID");

  // Cerminan /campaigns/:id/preflight. Di produk jadi, sumber kebenarannya
  // adalah server — UI hanya menampilkan hasilnya (04-aturan-kepatuhan.md).
  const compliance: { label: string; ok: boolean; detail: React.ReactNode }[] = [
    {
      label: "Panjang subject ≤ 60 karakter",
      ok: subLen <= 60,
      detail: <><Num>{subLen}</Num> karakter</>,
    },
    {
      label: "Tautan berhenti berlangganan ada",
      ok: true,
      detail: "Disisipkan server, tidak dapat dihapus",
    },
    {
      label: "Identitas pengirim ada",
      ok: true,
      detail: SENDER.address,
    },
    {
      label: "Volume dalam batas pemanasan",
      ok: !isBlocked,
      detail: isBlocked ? (
        <>
          <Num>{fmt(recipients)}</Num> melebihi sisa <Num>{fmt(DAILY_REMAINING)}</Num>
        </>
      ) : (
        <>
          <Num>{fmt(recipients)}</Num> ≤ <Num>{fmt(DAILY_REMAINING)}</Num> tersisa
        </>
      ),
    },
    {
      label: "Sumber izin tercatat untuk seluruh penerima",
      ok: selectedSegment !== "all",
      detail:
        selectedSegment === "all"
          ? "Sebagian kontak belum punya sumber izin tercatat"
          : "Seluruh penerima punya sumber izin tercatat",
    },
  ];

  return (
    <div className="p-6 max-w-5xl">
      <StepBar steps={["Pilih Segmen", "Tulis Pesan", "Tinjau & Kirim"]} current={step} />

      {/* ── Langkah 1 ── */}
      {step === 1 && (
        <div className="space-y-4">
          <SectionTitle
            label="Pilih Segmen Penerima"
            sub="Pilih kelompok penerima. Jumlah akan disesuaikan dengan batas kirim harian aktif."
          />

          <div className="bg-card border border-border rounded-sm p-3 flex items-center gap-2 mb-2">
            <Shield size={12} style={{ color: "#c4824a", flexShrink: 0 }} />
            <span className="text-xs text-muted-foreground">
              Batas pengiriman hari ini:{" "}
              <span className="text-foreground">
                <Num>{fmt(DAILY_REMAINING)}</Num> email tersisa
              </span>{" "}
              · Tahap pemanasan{" "}
              <Num>
                {DOMAIN.warmupStage}/{DOMAIN.warmupTotal}
              </Num>
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
                      style={{
                        borderColor: selected ? "#c4824a" : "rgba(100,140,180,0.3)",
                        backgroundColor: selected ? "#c4824a" : "transparent",
                      }}
                    >
                      {selected && <Check size={9} color="#fff" />}
                    </div>
                    <span className="text-xs text-foreground">{seg.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {over && (
                      <span className="text-xs flex items-center gap-1" style={{ color: "#e05252" }}>
                        <AlertTriangle size={11} /> Melebihi batas harian
                      </span>
                    )}
                    <Num
                      className="text-sm font-semibold"
                      style={{ color: over ? "#e05252" : "#dce3ec" }}
                    >
                      {fmt(seg.count)}
                    </Num>
                    <span className="text-xs text-muted-foreground">penerima</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 text-xs rounded-sm flex items-center gap-2"
              style={{ backgroundColor: "#c4824a", color: "#fff" }}
            >
              Lanjut: Tulis Pesan <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── Langkah 2 ── */}
      {step === 2 && (
        <div className="space-y-4">
          <SectionTitle
            label="Tulis Pesan"
            sub="Gunakan variabel untuk personalisasi. Pratinjau dirender dari kontak pertama."
          />
          <div className="grid grid-cols-2 gap-5">
            {/* Editor */}
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-xs text-muted-foreground mr-1">Variabel:</span>
                {VARIABLES.map((v) => (
                  <button
                    key={v}
                    onClick={() => setBody((b) => `${b} ${v}`)}
                    className="px-1.5 py-0.5 text-xs font-mono rounded-sm transition-colors"
                    style={{
                      backgroundColor: "rgba(196,130,74,0.13)",
                      color: "#c4824a",
                      border: "1px solid rgba(196,130,74,0.28)",
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>

              <div>
                <label className="flex items-center gap-1 text-xs mb-1" style={{ color: "#6a82a0" }}>
                  <span className="uppercase font-medium" style={{ letterSpacing: "0.06em" }}>
                    Baris subjek
                  </span>
                  <Num style={{ color: subLen > 60 ? "#e05252" : "#6a82a0" }}>{subLen}/60</Num>
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full bg-card border rounded-sm px-3 py-2 text-xs text-foreground outline-none"
                  style={{
                    borderColor: subLen > 60 ? "#8c2e2e" : "rgba(100,140,180,0.12)",
                    caretColor: "#c4824a",
                  }}
                />
              </div>

              <div>
                <PanelLabel className="mb-1">Isi pesan</PanelLabel>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={12}
                  className="w-full bg-card border border-border rounded-sm px-3 py-2 text-xs text-foreground outline-none resize-none leading-relaxed"
                  style={{ caretColor: "#c4824a" }}
                />
              </div>
            </div>

            {/* Pratinjau */}
            <div>
              <PanelLabel className="mb-1">Pratinjau langsung</PanelLabel>
              <div className="bg-secondary/20 border border-border rounded-sm overflow-hidden">
                <div
                  className="border-b border-border px-4 py-2.5 space-y-1"
                  style={{ backgroundColor: "rgba(100,140,180,0.05)" }}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground w-14 flex-shrink-0">Dari:</span>
                    <span className="text-xs text-foreground break-all">
                      {SENDER.name} &lt;<Mono>{SENDER.email}</Mono>&gt;
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground w-14 flex-shrink-0">Ke:</span>
                    <Mono className="text-xs text-foreground break-all">{SAMPLE.email}</Mono>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground w-14 flex-shrink-0">Subjek:</span>
                    <span className="text-xs text-foreground break-words">{render(subject)}</span>
                  </div>
                </div>
                <div className="px-4 py-3">
                  <pre
                    className="text-xs text-foreground whitespace-pre-wrap leading-relaxed"
                    style={{ fontFamily: "inherit" }}
                  >
                    {render(body)}
                  </pre>
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-xs text-muted-foreground">
                      Tidak ingin menerima email ini?{" "}
                      <span style={{ color: "#c4824a", textDecoration: "underline" }}>
                        Berhenti berlangganan
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {SENDER.company} · {SENDER.address}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 text-xs border border-border rounded-sm text-muted-foreground flex items-center gap-2 hover:text-foreground transition-colors"
            >
              <ArrowLeft size={13} /> Kembali
            </button>
            <button
              onClick={() => setStep(3)}
              className="px-4 py-2 text-xs rounded-sm flex items-center gap-2"
              style={{ backgroundColor: "#c4824a", color: "#fff" }}
            >
              Tinjau Kampanye <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── Langkah 3 ── */}
      {step === 3 && (
        <div className="space-y-4">
          <SectionTitle
            label="Tinjau & Kirim"
            sub="Kampanye hanya dapat dikirim jika semua syarat kepatuhan terpenuhi."
          />

          {isBlocked && (
            <div
              className="rounded-sm p-4 flex items-start gap-3 border"
              style={{
                backgroundColor: "rgba(140,46,46,0.14)",
                borderColor: "rgba(224,82,82,0.28)",
              }}
            >
              <XCircle size={16} style={{ color: "#e05252", flexShrink: 0, marginTop: 1 }} />
              <div>
                <p
                  className="text-sm font-semibold uppercase tracking-wide mb-1"
                  style={{
                    fontFamily: "'Barlow Condensed', sans-serif",
                    color: "#e05252",
                    letterSpacing: "0.08em",
                  }}
                >
                  Kampanye Ditahan — Melebihi Batas Pemanasan
                </p>
                <p className="text-xs text-muted-foreground">
                  Segmen yang dipilih (<Num>{fmt(recipients)}</Num> penerima) melebihi sisa kuota
                  harian (<Num>{fmt(DAILY_REMAINING)}</Num> email). Mengirim melebihi batas ini
                  berisiko merusak reputasi domain. Pilih segmen lebih kecil atau tunggu hari
                  berikutnya.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-sm p-4">
              <PanelLabel className="mb-3">Ringkasan kampanye</PanelLabel>
              {[
                { label: "Segmen", value: segment?.label ?? "—", mono: false },
                { label: "Penerima", value: `${fmt(recipients)} kontak`, mono: true },
                {
                  label: "Subjek",
                  value: subject.length > 42 ? `${subject.slice(0, 42)}…` : subject,
                  mono: false,
                },
                { label: "Pengirim", value: SENDER.email, mono: true },
                { label: "Domain", value: DOMAIN.name, mono: true },
              ].map(({ label, value, mono }) => (
                <div
                  key={label}
                  className="flex justify-between gap-3 py-1.5 border-b border-border last:border-0 text-xs"
                >
                  <span className="text-muted-foreground flex-shrink-0">{label}</span>
                  <span
                    className={`text-foreground text-right max-w-[200px] truncate ${
                      mono ? "font-mono" : ""
                    }`}
                    title={value}
                  >
                    {value}
                  </span>
                </div>
              ))}
            </div>

            <div className="bg-card border border-border rounded-sm p-4">
              <PanelLabel className="mb-3">Daftar kepatuhan</PanelLabel>
              <div className="space-y-2.5">
                {compliance.map((item) => (
                  <div key={item.label} className="flex items-start gap-2">
                    {item.ok ? (
                      <CheckCircle
                        size={13}
                        style={{ color: "#5cc9a0", flexShrink: 0, marginTop: 1 }}
                      />
                    ) : (
                      <XCircle size={13} style={{ color: "#e05252", flexShrink: 0, marginTop: 1 }} />
                    )}
                    <div>
                      <p className="text-xs" style={{ color: item.ok ? "#dce3ec" : "#e05252" }}>
                        {item.label}
                      </p>
                      <p className="text-xs text-muted-foreground">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 text-xs border border-border rounded-sm text-muted-foreground flex items-center gap-2 hover:text-foreground transition-colors"
            >
              <ArrowLeft size={13} /> Kembali
            </button>
            <button
              disabled={isBlocked}
              className="px-6 py-2 text-xs rounded-sm flex items-center gap-2 transition-all"
              style={{
                backgroundColor: isBlocked ? "rgba(140,46,46,0.25)" : "#2b7a5a",
                color: isBlocked ? "#e05252" : "#fff",
                cursor: isBlocked ? "not-allowed" : "pointer",
              }}
            >
              <Send size={13} />
              {isBlocked ? (
                "Pengiriman Ditahan"
              ) : (
                <>
                  Kirim ke <Num>{fmt(recipients)}</Num> Penerima
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
