import type React from "react";
import { AlertCircle, Loader2, Shield } from "lucide-react";
import { useDomainHealth } from "../lib/domainHealth";
import { Mono, Num, PanelLabel } from "./Typography";
import { RunwayPemanasan } from "./RunwayPemanasan";

type Level = "ok" | "warn" | "risk" | "kosong";

const col = (s: Level) =>
  s === "ok" ? "var(--sukses)" : s === "warn" ? "var(--peringatan)" : s === "risk" ? "var(--bahaya)" : "var(--muted-foreground)";
const bg = (s: Level) =>
  s === "ok"
    ? "rgb(var(--sukses-rgb) / 0.13)"
    : s === "warn"
      ? "rgb(var(--peringatan-rgb) / 0.13)"
      : s === "risk"
        ? "rgb(var(--bahaya-rgb) / 0.18)"
        : "rgb(var(--kabut-rgb) / 0.05)";
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
            <p className="text-xs" style={{ color: "var(--bahaya)" }}>
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
  // Sisa dan persentase harian kini dihitung di dalam runway, bersama jadwal
  // tahapnya — satu tempat, supaya angka "tersisa hari ini" tidak muncul dua
  // kali dengan pembulatan yang berbeda.

  const waktu = new Date(data.diperbarui_pada).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="bg-card border border-border rounded-sm p-4 mb-5">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-2">
          <Shield size={13} style={{ color: "var(--primary)" }} />
          <span
            className="text-xs uppercase tracking-widest font-semibold"
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              color: "var(--foreground)",
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
            backgroundColor: "rgb(var(--kabut-rgb) / 0.06)",
            borderColor: "rgb(var(--kabut-rgb) / 0.16)",
          }}
        >
          <AlertCircle size={13} style={{ color: "var(--secondary-foreground)", flexShrink: 0, marginTop: 1 }} />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Belum ada kampanye terkirim dari domain ini, jadi{" "}
            <span className="text-foreground">bounce dan keluhan belum dapat diukur</span>. Angkanya
            muncul setelah pengiriman pertama — sampai saat itu kosong, bukan nol. Tahap pemanasan
            di bawah adalah tahap awal setiap domain baru, bukan hasil perhitungan.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
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

      </div>

      {/* Runway menggantikan dua kartu sempit yang dulu terpisah — "tahap
          pemanasan" dan "kirim hari ini". Keduanya menjawab pertanyaan yang
          sama dari sisi berbeda, dan dipisah keduanya jadi angka tanpa
          konteks. */}
      <div className="mt-3">
        <RunwayPemanasan
          jadwal={warmup.jadwal ?? []}
          tahapSekarang={warmup.stage}
          terpakaiHariIni={warmup.sent_today}
          sisaHariIni={warmup.remaining_today}
          batasHariIni={warmup.daily_limit}
        />
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
