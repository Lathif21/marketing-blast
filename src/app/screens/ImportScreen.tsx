import { useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  Loader2,
  Lock,
  Upload,
  XCircle,
} from "lucide-react";
import { SectionTitle } from "../components/SectionTitle";
import { StepBar } from "../components/StepBar";
import { Mono, Num, PanelLabel } from "../components/Typography";
import {
  ApiError,
  cancelImport,
  commitImport,
  saveImportMapping,
  uploadImport,
  type ImportPreview,
  type ImportValidation,
} from "../lib/api";
import { CONSENT_LABELS, CONSENT_SOURCES, type ConsentSource } from "../lib/types";
import type { ImportStep } from "../lib/types";

/** Field yang dapat dipetakan untuk berkas CSV biasa. */
const MAP_FIELDS = [
  { field: "Email *", key: "email", required: true },
  { field: "Nama Perusahaan", key: "company", required: false },
  { field: "Situs Web", key: "website", required: false },
  { field: "Alamat", key: "address", required: false },
  { field: "Telepon", key: "phone", required: false },
];

export function ImportScreen() {
  const [step, setStep] = useState<ImportStep>(1);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [validation, setValidation] = useState<ImportValidation | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [consentSource, setConsentSource] = useState<ConsentSource | "">("");
  const [declaredBy, setDeclaredBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fromHarvester = preview?.detected_source === "contact_harvester";

  const reset = () => {
    setStep(1);
    setFile(null);
    setPassword("");
    setPreview(null);
    setValidation(null);
    setMapping({});
    setConsentSource("");
    setCommitted(null);
    setError(null);
  };

  const pesanGalat = (err: unknown) =>
    err instanceof ApiError ? err.message : ((err as Error)?.message ?? "Galat tidak dikenal");

  async function unggah(selected: File) {
    setBusy(true);
    setError(null);
    try {
      const result = await uploadImport(selected, password || undefined);
      setPreview(result);
      setFile(selected);
      // Berkas Contact Harvester tidak perlu dipetakan — langkah 2 hanya
      // menampilkan konfirmasi dan pernyataan sumber izin.
      setMapping(result.detected_source === "contact_harvester" ? {} : tebakPemetaan(result.columns));
      setStep(2);
    } catch (err) {
      setError(pesanGalat(err));
    } finally {
      setBusy(false);
    }
  }

  async function validasi() {
    if (!preview || !consentSource) return;
    setBusy(true);
    setError(null);
    try {
      setValidation(await saveImportMapping(preview.batch_id, mapping, consentSource, declaredBy));
      setStep(3);
    } catch (err) {
      setError(pesanGalat(err));
    } finally {
      setBusy(false);
    }
  }

  async function simpan() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const result = await commitImport(preview.batch_id);
      setCommitted(result.imported);
    } catch (err) {
      setError(pesanGalat(err));
    } finally {
      setBusy(false);
    }
  }

  async function batal() {
    if (!preview) return reset();
    setBusy(true);
    try {
      await cancelImport(preview.batch_id);
    } catch {
      // Sesi yang sudah kedaluwarsa di server tidak menyisakan apa pun,
      // jadi kegagalan di sini tidak perlu menahan pengguna.
    } finally {
      setBusy(false);
      reset();
    }
  }

  const consentTerisi = consentSource !== "" && declaredBy.trim() !== "";
  const mappingLengkap = fromHarvester || Boolean(mapping.email);
  const bolehLanjut = consentTerisi && mappingLengkap;

  return (
    <div className="p-6 max-w-4xl">
      <StepBar steps={["Unggah Berkas", "Pemetaan & Izin", "Validasi & Konfirmasi"]} current={step} />

      {error && (
        <div
          className="rounded-sm p-3 mb-4 flex items-start gap-2 border"
          style={{ backgroundColor: "rgba(140,46,46,0.14)", borderColor: "rgba(224,82,82,0.28)" }}
        >
          <XCircle size={14} style={{ color: "#e05252", flexShrink: 0, marginTop: 1 }} />
          <p className="text-xs" style={{ color: "#e05252" }}>
            {error}
          </p>
        </div>
      )}

      {/* ── Langkah 1 ── */}
      {step === 1 && (
        <div className="space-y-4">
          <SectionTitle
            label="Unggah Berkas"
            sub="Unggah file CSV atau file terenkripsi .enc berisi daftar kontak bisnis."
          />

          <input
            ref={inputRef}
            type="file"
            accept=".csv,.enc,text/csv"
            className="hidden"
            onChange={(e) => {
              const selected = e.target.files?.[0];
              if (selected) void unggah(selected);
            }}
          />

          <button
            type="button"
            disabled={busy}
            className="w-full border-2 border-dashed rounded-sm p-12 text-center cursor-pointer transition-colors"
            style={{
              borderColor: file ? "#2b7a5a" : "rgba(100,140,180,0.22)",
              backgroundColor: file ? "rgba(43,122,90,0.08)" : "rgba(100,140,180,0.03)",
            }}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 size={28} className="animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Membaca berkas…</span>
              </div>
            ) : file ? (
              <div className="flex flex-col items-center gap-2">
                <CheckCircle size={32} style={{ color: "#5cc9a0" }} />
                <Mono className="text-sm" style={{ color: "#5cc9a0" }}>
                  {file.name}
                </Mono>
                <span className="text-xs text-muted-foreground">klik untuk ganti file</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload size={28} className="text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Klik untuk memilih file CSV atau .enc
                </span>
                <span className="text-xs text-muted-foreground">
                  Keluaran Contact Harvester terdeteksi otomatis
                </span>
              </div>
            )}
          </button>

          <div className="bg-card border border-border rounded-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <Lock size={12} style={{ color: "#c4824a" }} />
              <span className="text-xs font-medium text-foreground">File Terenkripsi (.enc)</span>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Isi password dekripsi sebelum memilih berkas. Dekripsi dilakukan di memori server —
              berkas terdekripsi tidak pernah ditulis ke disk.
            </p>
            <input
              type="password"
              placeholder="Password dekripsi..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-secondary border border-border rounded-sm px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none"
              style={{ caretColor: "#c4824a" }}
            />
          </div>
        </div>
      )}

      {/* ── Langkah 2 ── */}
      {step === 2 && preview && (
        <div className="space-y-4">
          <SectionTitle
            label={fromHarvester ? "Konfirmasi Pemetaan" : "Pemetaan Kolom"}
            sub={
              fromHarvester
                ? "Susunan kolom cocok dengan keluaran Contact Harvester, jadi pemetaan sudah otomatis."
                : "Cocokkan kolom dari file Anda. Pratinjau 5 baris pertama ditampilkan."
            }
          />

          {fromHarvester && (
            <div
              className="rounded-sm p-3 flex items-start gap-2 border"
              style={{
                backgroundColor: "rgba(43,122,90,0.1)",
                borderColor: "rgba(92,201,160,0.25)",
              }}
            >
              <CheckCircle size={13} style={{ color: "#5cc9a0", flexShrink: 0, marginTop: 1 }} />
              <p className="text-xs text-muted-foreground">
                Terdeteksi <strong className="text-foreground">Contact Harvester</strong> —{" "}
                <Num>13</Num> kolom dikenali. Kolom <Mono>whatsapp</Mono> dan <Mono>phone</Mono>{" "}
                disimpan sebagai rujukan saja, tidak dapat dipakai mengirim.
              </p>
            </div>
          )}

          {/*
            Pratinjau menampilkan isi berkas apa adanya, jadi tetap monospace —
            yang dibaca pengguna di sini adalah data mentah, bukan prosa.
          */}
          <div className="bg-card border border-border rounded-sm overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  {preview.columns.map((c) => (
                    <th
                      key={c}
                      className="px-3 py-2 text-left font-mono text-muted-foreground whitespace-nowrap"
                      style={{ backgroundColor: "rgba(100,140,180,0.06)" }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {preview.columns.map((_, j) => (
                      <td key={j} className="px-3 py-2 font-mono text-foreground whitespace-nowrap">
                        {row[j] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!fromHarvester && (
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
                      {preview.columns.map((c) => (
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
          )}

          {/* Pernyataan sumber izin — memblokir seluruh impor bila kosong. */}
          <div
            className="bg-card border rounded-sm p-4"
            style={{ borderColor: consentTerisi ? "rgba(100,140,180,0.12)" : "rgba(212,160,64,0.4)" }}
          >
            <PanelLabel className="mb-1">Sumber izin (wajib)</PanelLabel>
            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
              Nyatakan dari mana daftar ini berasal. Impor tidak dapat dilanjutkan tanpa ini —
              dan berlaku untuk seluruh berkas, bukan per baris. Pernyataan dicatat beserta nama
              dan waktunya sebagai jejak audit, bukan sebagai pengalihan tanggung jawab.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={consentSource}
                onChange={(e) => setConsentSource(e.target.value as ConsentSource)}
                className="bg-secondary border border-border rounded-sm px-2 py-1.5 text-xs text-foreground outline-none"
              >
                <option value="">— pilih sumber izin —</option>
                {CONSENT_SOURCES.map((c) => (
                  <option key={c} value={c}>
                    {CONSENT_LABELS[c]}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Dinyatakan oleh (nama Anda)"
                value={declaredBy}
                onChange={(e) => setDeclaredBy(e.target.value)}
                className="bg-secondary border border-border rounded-sm px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none"
                style={{ caretColor: "#c4824a" }}
              />
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => void batal()}
              className="px-4 py-2 text-xs border border-border rounded-sm text-muted-foreground flex items-center gap-2 transition-colors hover:text-foreground"
            >
              <ArrowLeft size={13} /> Batalkan
            </button>
            <button
              onClick={() => void validasi()}
              disabled={!bolehLanjut || busy}
              title={bolehLanjut ? undefined : "Sumber izin dan nama penyata wajib diisi"}
              className="px-4 py-2 text-xs rounded-sm flex items-center gap-2 transition-all"
              style={{
                backgroundColor: bolehLanjut && !busy ? "#c4824a" : "rgba(100,140,180,0.1)",
                color: bolehLanjut && !busy ? "#fff" : "#6a82a0",
                cursor: bolehLanjut && !busy ? "pointer" : "not-allowed",
              }}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : null}
              Lanjut: Validasi <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── Langkah 3 ── */}
      {step === 3 && validation && (
        <div className="space-y-4">
          <SectionTitle
            label="Ringkasan Validasi"
            sub={
              committed === null
                ? "Belum ada satu baris pun yang tersimpan. Periksa dulu, lalu konfirmasi."
                : "Impor selesai."
            }
          />

          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "Diterima", count: validation.accepted, color: "#5cc9a0", bg: "rgba(43,122,90,0.15)", desc: "Tersimpan, siap dikirim setelah verifikasi" },
              { label: "Karantina", count: validation.quarantined, color: "#d4a040", bg: "rgba(180,120,30,0.15)", desc: "Alamat hasil tebakan, perlu verifikasi" },
              { label: "Duplikat", count: validation.duplicates, color: "#8da0b8", bg: "rgba(106,130,160,0.1)", desc: "Sudah ada di basis data" },
              { label: "Ditolak", count: validation.rejected, color: "#e05252", bg: "rgba(140,46,46,0.15)", desc: "Format tidak valid atau ada di daftar penekanan" },
            ].map((s) => (
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

          {validation.notes.length > 0 && (
            <div className="bg-card border border-border rounded-sm p-4 space-y-2.5">
              <PanelLabel className="mb-1">Catatan validasi</PanelLabel>
              {validation.notes.map((n, i) => (
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
                      color: n.type === "warn" ? "#d4a040" : n.type === "error" ? "#e05252" : "#8da0b8",
                    }}
                  >
                    {n.text}
                  </span>
                </div>
              ))}
            </div>
          )}

          {committed !== null ? (
            <div
              className="rounded-sm p-4 flex items-start gap-3 border"
              style={{ backgroundColor: "rgba(43,122,90,0.12)", borderColor: "rgba(92,201,160,0.3)" }}
            >
              <CheckCircle size={16} style={{ color: "#5cc9a0", flexShrink: 0, marginTop: 1 }} />
              <div>
                <p className="text-xs text-foreground mb-1">
                  <Num>{committed.toLocaleString("id-ID")}</Num> kontak tersimpan.
                </p>
                <p className="text-xs text-muted-foreground">
                  Semuanya berstatus karantina sampai lolos verifikasi alamat. Batch ini dapat
                  dibatalkan sampai <Num>30</Num> hari — alamat yang sudah masuk daftar penekanan
                  tetap tinggal.
                </p>
                <button
                  onClick={reset}
                  className="mt-2 px-3 py-1.5 text-xs border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Impor berkas lain
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-between">
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2 text-xs border border-border rounded-sm text-muted-foreground flex items-center gap-2 transition-colors hover:text-foreground"
              >
                <ArrowLeft size={13} /> Kembali
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => void batal()}
                  className="px-3 py-2 text-xs border border-border rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Batalkan
                </button>
                <button
                  onClick={() => void simpan()}
                  disabled={busy}
                  className="px-4 py-2 text-xs rounded-sm flex items-center gap-2"
                  style={{
                    backgroundColor: busy ? "rgba(100,140,180,0.1)" : "#2b7a5a",
                    color: busy ? "#6a82a0" : "#fff",
                    cursor: busy ? "not-allowed" : "pointer",
                  }}
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Konfirmasi Impor <Num>{validation.accepted.toLocaleString("id-ID")}</Num> Kontak
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Tebakan awal pemetaan dari nama kolom yang umum dipakai. */
function tebakPemetaan(columns: string[]): Record<string, string> {
  const cari = (...kandidat: string[]) =>
    columns.find((c) => kandidat.some((k) => c.toLowerCase().includes(k))) ?? "";

  return {
    email: cari("email", "surel"),
    company: cari("perusahaan", "company", "nama"),
    website: cari("website", "situs", "web"),
    address: cari("alamat", "address"),
    phone: cari("telepon", "phone", "telp"),
  };
}
