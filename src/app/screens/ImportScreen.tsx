import { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  Download,
  Lock,
  Upload,
  XCircle,
} from "lucide-react";
import { SectionTitle } from "../components/SectionTitle";
import { StepBar } from "../components/StepBar";
import { Mono, Num, PanelLabel } from "../components/Typography";
import {
  CSV_COLS,
  CSV_ROWS,
  IMPORT_FILENAME,
  IMPORT_NOTES,
  IMPORT_ROW_COUNT,
  IMPORT_SUMMARY,
} from "../lib/mock";
import type { ImportStep } from "../lib/types";

const MAP_FIELDS = [
  { field: "Email *",           key: "email",    required: true  },
  { field: "Nama Perusahaan *", key: "company",  required: true  },
  { field: "Industri",          key: "industry", required: false },
  { field: "Kota",              key: "city",     required: false },
];

const ACCEPTED = IMPORT_SUMMARY.find((s) => s.label === "Diterima")?.count ?? 0;

export function ImportScreen() {
  const [step, setStep] = useState<ImportStep>(1);
  const [fileUploaded, setFileUploaded] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({
    email: "email_bisnis",
    company: "nama_perusahaan",
    industry: "",
    city: "",
  });

  const mappingComplete = MAP_FIELDS.every((f) => !f.required || Boolean(mapping[f.key]));

  return (
    <div className="p-6 max-w-4xl">
      <StepBar steps={["Unggah Berkas", "Pemetaan Kolom", "Validasi & Konfirmasi"]} current={step} />

      {/* ── Langkah 1 ── */}
      {step === 1 && (
        <div className="space-y-4">
          <SectionTitle
            label="Unggah Berkas"
            sub="Unggah file CSV atau file terenkripsi .enc berisi daftar kontak bisnis."
          />

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
                <Mono className="text-sm" style={{ color: "#5cc9a0" }}>
                  {IMPORT_FILENAME}
                </Mono>
                <span className="text-xs text-muted-foreground">
                  <Num>{IMPORT_ROW_COUNT.toLocaleString("id-ID")}</Num> baris terdeteksi ·{" "}
                  <Num>4,2 KB</Num>
                </span>
                <span className="text-xs text-muted-foreground">klik untuk ganti file</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload size={28} className="text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Seret &amp; letakkan file CSV atau .enc di sini
                </span>
                <span className="text-xs text-muted-foreground">atau klik untuk memilih file</span>
              </div>
            )}
          </button>

          <div className="bg-card border border-border rounded-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <Lock size={12} style={{ color: "#c4824a" }} />
              <span className="text-xs font-medium text-foreground">File Terenkripsi (.enc)</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Jika file Anda dienkripsi, masukkan password dekripsi sebelum impor.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                placeholder="Password dekripsi..."
                className="flex-1 bg-secondary border border-border rounded-sm px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none"
                style={{ caretColor: "#c4824a" }}
              />
              <button className="px-3 py-1.5 text-xs border border-border rounded-sm text-muted-foreground transition-colors hover:text-foreground">
                Verifikasi
              </button>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => fileUploaded && setStep(2)}
              disabled={!fileUploaded}
              className="px-4 py-2 text-xs rounded-sm flex items-center gap-2 transition-all"
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

      {/* ── Langkah 2 ── */}
      {step === 2 && (
        <div className="space-y-4">
          <SectionTitle
            label="Pemetaan Kolom"
            sub="Cocokkan kolom dari file Anda. Pratinjau 5 baris pertama ditampilkan."
          />

          {/*
            Pratinjau ini menampilkan isi berkas apa adanya, jadi tetap monospace —
            yang dibaca pengguna di sini adalah data mentah, bukan prosa.
          */}
          <div className="bg-card border border-border rounded-sm overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {CSV_COLS.map((c) => (
                    <th
                      key={c}
                      className="px-3 py-2 text-left font-mono text-muted-foreground"
                      style={{ backgroundColor: "rgba(100,140,180,0.06)" }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CSV_ROWS.map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {row.map((cell, j) => (
                      <td key={j} className="px-3 py-2 font-mono text-foreground">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-card border border-border rounded-sm p-4">
            <PanelLabel className="mb-3">Pemetaan field</PanelLabel>
            <div className="grid grid-cols-2 gap-3">
              {MAP_FIELDS.map(({ field, key, required }) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-36 text-xs text-foreground flex-shrink-0">{field}</span>
                  <span className="text-muted-foreground text-xs">→</span>
                  <select
                    className="flex-1 bg-secondary border border-border rounded-sm px-2 py-1 text-xs text-foreground outline-none"
                    value={mapping[key] ?? ""}
                    onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value }))}
                  >
                    <option value="">— tidak dipetakan —</option>
                    {CSV_COLS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {required && !mapping[key] && (
                    <AlertCircle size={12} style={{ color: "#d4a040", flexShrink: 0 }} />
                  )}
                  {required && mapping[key] && (
                    <Check size={12} style={{ color: "#5cc9a0", flexShrink: 0 }} />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 text-xs border border-border rounded-sm text-muted-foreground flex items-center gap-2 transition-colors hover:text-foreground"
            >
              <ArrowLeft size={13} /> Kembali
            </button>
            <button
              onClick={() => mappingComplete && setStep(3)}
              disabled={!mappingComplete}
              title={mappingComplete ? undefined : "Petakan semua field wajib terlebih dahulu"}
              className="px-4 py-2 text-xs rounded-sm flex items-center gap-2 transition-all"
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

      {/* ── Langkah 3 ── */}
      {step === 3 && (
        <div className="space-y-4">
          <SectionTitle
            label="Ringkasan Validasi"
            sub="Periksa hasil validasi sebelum konfirmasi impor."
          />

          <div className="grid grid-cols-4 gap-3">
            {IMPORT_SUMMARY.map((s) => (
              <div
                key={s.label}
                className="rounded-sm p-3"
                style={{ backgroundColor: s.bg, border: `1px solid ${s.color}25` }}
              >
                <PanelLabel className="mb-1">{s.label}</PanelLabel>
                <Num className="text-2xl font-semibold block" style={{ color: s.color }}>
                  {s.count.toLocaleString("id-ID")}
                </Num>
                <div className="text-xs text-muted-foreground mt-0.5">{s.desc}</div>
              </div>
            ))}
          </div>

          <div className="bg-card border border-border rounded-sm p-4 space-y-2.5">
            <PanelLabel className="mb-1">Catatan validasi</PanelLabel>
            {IMPORT_NOTES.map((n, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                {n.type === "warn" && (
                  <AlertTriangle size={12} style={{ color: "#d4a040", flexShrink: 0, marginTop: 1 }} />
                )}
                {n.type === "info" && (
                  <AlertCircle size={12} style={{ color: "#8da0b8", flexShrink: 0, marginTop: 1 }} />
                )}
                {n.type === "error" && (
                  <XCircle size={12} style={{ color: "#e05252", flexShrink: 0, marginTop: 1 }} />
                )}
                <span
                  style={{
                    color:
                      n.type === "warn" ? "#d4a040" : n.type === "error" ? "#e05252" : "#8da0b8",
                  }}
                >
                  {n.text}
                </span>
              </div>
            ))}
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 text-xs border border-border rounded-sm text-muted-foreground flex items-center gap-2 transition-colors hover:text-foreground"
            >
              <ArrowLeft size={13} /> Kembali
            </button>
            <div className="flex gap-2">
              <button className="px-3 py-2 text-xs border border-border rounded-sm text-muted-foreground flex items-center gap-1.5 transition-colors hover:text-foreground">
                <Download size={12} /> Unduh Laporan Error
              </button>
              <button
                className="px-4 py-2 text-xs rounded-sm flex items-center gap-2"
                style={{ backgroundColor: "#2b7a5a", color: "#fff" }}
              >
                <Check size={13} /> Konfirmasi Impor{" "}
                <Num>{ACCEPTED.toLocaleString("id-ID")}</Num> Kontak
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
