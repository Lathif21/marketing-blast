import type React from "react";
import { AlertCircle, Loader2, Shield } from "lucide-react";
import { useDomainHealth } from "../lib/domainHealth";
import { Mono, Num, PanelLabel } from "./Typography";

type Level = "ok" | "warn" | "risk" | "kosong";

const col = (s: Level) =>
  s === "ok" ? "#5cc9a0" : s === "warn" ? "#d4a040" : s === "risk" ? "#e05252" : "#6a82a0";
const bg = (s: Level) =>
  s === "ok"
    ? "rgba(43,122,90,0.13)"
    : s === "warn"
      ? "rgba(180,120,30,0.13)"
      : s === "risk"
        ? "rgba(140,46,46,0.18)"
        : "rgba(100,140,180,0.05)";
const lbl = (s: Level) =>
  s === "ok" ? "Baik" : s === "warn" ? "Perhatian" : s === "risk" ? "Kritis" : "Belum terukur";

/**
 * Metrik yang belum punya sumber data ditampilkan sebagai "—", bukan 0.
 *
 * Ini bukan kerapian: 0% bounce terbaca sebagai sangat sehat, sedangkan yang
 * sebenarnya terjadi adalah belum ada satu pun email terkirim sehingga tidak
 * ada yang bisa diukur. Angka yang terlihat meyakinkan padahal tidak nyata
 * adalah kekeliruan yang paling mahal di layar pertama.
 */
function tingkat(nilai: number | null, ambang: { perhatian: number; kritis: number }): Level {
  if (nilai === null) return "kosong";
  return nilai < ambang.perhatian ? "ok" : nilai < ambang.kritis ? "warn" : "risk";
}

function Kartu({
  label,
  level,
  children,
  bawah,
}: {
  label: string;
  level: Level;
  children: React.ReactNode;
  bawah?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-sm p-3"
      style={{ backgroundColor: bg(level), border: `1px solid ${col(level)}22` }}
    >
      <PanelLabel className="mb-1">{label}</PanelLabel>
      {children}
      {bawah}
    </div>
  );
}

export function DomainHealthPanel() {
  const { status, data, error, reload } = useDomainHealth();

  if (!data) {
    return (
      <div className="bg-card border border-border rounded-sm p-4 mb-5">
        {status === "gagal" ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs" style={{ color: "#e05252" }}>
              Kesehatan domain tidak dapat dimuat: {error}
            </p>
            <button
              onClick={reload}
              className="px-3 py-1.5 text-xs border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Coba lagi
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 size={13} className="animate-spin" />
            Memuat kesehatan domain…
          </div>
        )}
      </div>
    );
  }

  const { warmup, reputation, sumber } = data;
  const bounceLevel = tingkat(reputation.bounce_rate_7d, reputation.thresholds.bounce);
  const keluhanLevel = tingkat(reputation.complaint_rate_7d, reputation.thresholds.keluhan);

  const belumKirim = sumber.pengiriman !== "tersedia";
  const limit = warmup.daily_limit;
  const sisa = warmup.remaining_today;
  const sentPct = limit && limit > 0 ? (warmup.sent_today / limit) * 100 : 0;

  const waktu = new Date(data.diperbarui_pada).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="bg-card border border-border rounded-sm p-4 mb-5">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-2">
          <Shield size={13} style={{ color: "#c4824a" }} />
          <span
            className="text-xs uppercase tracking-widest font-semibold"
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              color: "#dce3ec",
              letterSpacing: "0.12em",
            }}
          >
            Kesehatan Domain — <Mono>{data.domain}</Mono>
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {status === "memuat" ? "menyegarkan…" : <>Diperbarui <Num>{waktu}</Num></>}
        </span>
      </div>

      {/*
        Penjelasan kenapa dua kotak di bawah kosong. Tanpa ini, kotak "—" bisa
        disalahartikan sebagai kegagalan memuat, bukan sebagai keadaan yang
        memang belum terukur.
      */}
      {belumKirim && (
        <div
          className="rounded-sm p-3 mb-3 flex items-start gap-2 border"
          style={{
            backgroundColor: "rgba(100,140,180,0.06)",
            borderColor: "rgba(100,140,180,0.16)",
          }}
        >
          <AlertCircle size={13} style={{ color: "#8da0b8", flexShrink: 0, marginTop: 1 }} />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Belum ada kampanye terkirim dari domain ini, jadi{" "}
            <span className="text-foreground">bounce dan keluhan belum dapat diukur</span>. Angkanya
            muncul setelah pengiriman pertama — sampai saat itu kosong, bukan nol. Tahap pemanasan
            di bawah adalah tahap awal setiap domain baru, bukan hasil perhitungan.
          </p>
        </div>
      )}

      <div className="grid grid-cols-4 gap-3">
        <Kartu
          label="Tingkat bounce"
          level={bounceLevel}
          bawah={
            <div className="flex items-center justify-between mt-1.5">
              <span className="flex items-center gap-1 text-xs" style={{ color: col(bounceLevel) }}>
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: col(bounceLevel) }}
                />
                {lbl(bounceLevel)}
              </span>
              <span className="text-xs text-muted-foreground">
                ambang <Num>{reputation.thresholds.bounce.perhatian}%</Num>
              </span>
            </div>
          }
        >
          {reputation.bounce_rate_7d === null ? (
            <span className="text-2xl font-semibold block" style={{ color: col("kosong") }}>
              —
            </span>
          ) : (
            <Num className="text-2xl font-semibold block" style={{ color: col(bounceLevel) }}>
              {reputation.bounce_rate_7d}%
            </Num>
          )}
        </Kartu>

        <Kartu
          label="Tingkat keluhan"
          level={keluhanLevel}
          bawah={
            <div className="flex items-center justify-between mt-1.5">
              <span className="flex items-center gap-1 text-xs" style={{ color: col(keluhanLevel) }}>
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: col(keluhanLevel) }}
                />
                {lbl(keluhanLevel)}
              </span>
              <span className="text-xs text-muted-foreground">
                ambang <Num>{reputation.thresholds.keluhan.perhatian}%</Num>
              </span>
            </div>
          }
        >
          {reputation.complaint_rate_7d === null ? (
            <span className="text-2xl font-semibold block" style={{ color: col("kosong") }}>
              —
            </span>
          ) : (
            <Num className="text-2xl font-semibold block" style={{ color: col(keluhanLevel) }}>
              {reputation.complaint_rate_7d}%
            </Num>
          )}
        </Kartu>

        {/* Tahap pemanasan — nyata: setiap domain baru mulai dari tahap 1. */}
        <div
          className="rounded-sm p-3"
          style={{
            backgroundColor: "rgba(196,130,74,0.1)",
            border: "1px solid rgba(196,130,74,0.2)",
          }}
        >
          <PanelLabel className="mb-1">Tahap pemanasan</PanelLabel>
          <div className="flex items-baseline gap-1">
            <Num className="text-2xl font-semibold" style={{ color: "#c4824a" }}>
              {warmup.stage}
            </Num>
            <Num className="text-sm text-muted-foreground">/ {warmup.total_stages}</Num>
          </div>
          <div className="flex gap-1 mt-2">
            {Array.from({ length: warmup.total_stages }).map((_, i) => (
              <div
                key={i}
                className="flex-1 h-1.5 rounded-sm"
                style={{
                  backgroundColor: i < warmup.stage ? "#c4824a" : "rgba(196,130,74,0.18)",
                }}
              />
            ))}
          </div>
          <div className="text-xs text-muted-foreground mt-1.5">
            {limit === null ? (
              "Tanpa batas tetap"
            ) : (
              <>
                batas <Num>{limit.toLocaleString("id-ID")}</Num>/hari
              </>
            )}
          </div>
        </div>

        {/* Kirim hari ini — nyata: nol karena memang belum ada yang dikirim. */}
        <div
          className="rounded-sm p-3"
          style={{
            backgroundColor: "rgba(100,140,180,0.07)",
            border: "1px solid rgba(100,140,180,0.12)",
          }}
        >
          <PanelLabel className="mb-1">Kirim hari ini</PanelLabel>
          <div className="flex items-baseline gap-1">
            <Num className="text-2xl font-semibold text-foreground">{warmup.sent_today}</Num>
            {limit !== null && (
              <Num className="text-sm text-muted-foreground">/ {limit}</Num>
            )}
          </div>
          <div className="mt-2">
            <div
              className="h-1.5 rounded-sm overflow-hidden"
              style={{ backgroundColor: "rgba(100,140,180,0.15)" }}
            >
              <div
                className="h-full rounded-sm"
                style={{
                  width: `${Math.min(sentPct, 100)}%`,
                  backgroundColor: sentPct > 80 ? "#d4a040" : "#8da0b8",
                }}
              />
            </div>
            <div className="flex justify-between mt-1 text-xs text-muted-foreground">
              {/*
                Angka yang dapat dipakai langsung, bukan sekadar persentase —
                "50 dari 50 tersisa" menjawab pertanyaan yang sebenarnya
                diajukan pengguna (03-layar-dan-alur.md §1).
              */}
              <span>
                {sisa === null ? (
                  "tanpa batas"
                ) : (
                  <>
                    <Num>{sisa.toLocaleString("id-ID")}</Num> dari{" "}
                    <Num>{limit?.toLocaleString("id-ID")}</Num> tersisa
                  </>
                )}
              </span>
              <Num>{sentPct.toFixed(0)}%</Num>
            </div>
          </div>
        </div>
      </div>

      {/* Satu angka reputasi yang sudah nyata sejak hari pertama. */}
      <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
        <span>Daftar penekanan:</span>
        <Num className="text-foreground">
          {data.suppression_total.toLocaleString("id-ID")}
        </Num>
        <span>alamat tidak akan pernah dikirimi lagi</span>
      </div>
    </div>
  );
}
