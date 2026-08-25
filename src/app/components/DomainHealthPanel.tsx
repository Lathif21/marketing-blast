import { Shield } from "lucide-react";
import { DAILY_REMAINING, DOMAIN } from "../lib/mock";
import { Mono, Num, PanelLabel } from "./Typography";

type Level = "ok" | "warn" | "risk";

const col = (s: Level) => (s === "ok" ? "#5cc9a0" : s === "warn" ? "#d4a040" : "#e05252");
const bg = (s: Level) =>
  s === "ok" ? "rgba(43,122,90,0.13)" : s === "warn" ? "rgba(180,120,30,0.13)" : "rgba(140,46,46,0.18)";
const lbl = (s: Level) => (s === "ok" ? "Baik" : s === "warn" ? "Perhatian" : "Kritis");

export function DomainHealthPanel() {
  const sentPct = (DOMAIN.sentToday / DOMAIN.dailyLimit) * 100;
  const bounceStatus: Level = DOMAIN.bounceRate < 2 ? "ok" : DOMAIN.bounceRate < 5 ? "warn" : "risk";
  const complaintStatus: Level =
    DOMAIN.complaintRate < 0.1 ? "ok" : DOMAIN.complaintRate < 0.3 ? "warn" : "risk";

  return (
    <div className="bg-card border border-border rounded-sm p-4 mb-5">
      <div className="flex items-center justify-between mb-4">
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
            Kesehatan Domain — <Mono>{DOMAIN.name}</Mono>
          </span>
        </div>
        <span className="text-xs text-muted-foreground">Diperbarui 2 mnt lalu</span>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {/* Tingkat bounce */}
        <div
          className="rounded-sm p-3"
          style={{ backgroundColor: bg(bounceStatus), border: `1px solid ${col(bounceStatus)}22` }}
        >
          <PanelLabel className="mb-1">Tingkat bounce</PanelLabel>
          <Num className="text-2xl font-semibold block" style={{ color: col(bounceStatus) }}>
            {DOMAIN.bounceRate}%
          </Num>
          <div className="flex items-center justify-between mt-1.5">
            <span className="flex items-center gap-1 text-xs" style={{ color: col(bounceStatus) }}>
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: col(bounceStatus) }}
              />
              {lbl(bounceStatus)}
            </span>
            <span className="text-xs text-muted-foreground">
              ambang <Num>2%</Num>
            </span>
          </div>
        </div>

        {/* Tingkat keluhan */}
        <div
          className="rounded-sm p-3"
          style={{
            backgroundColor: bg(complaintStatus),
            border: `1px solid ${col(complaintStatus)}22`,
          }}
        >
          <PanelLabel className="mb-1">Tingkat keluhan</PanelLabel>
          <Num className="text-2xl font-semibold block" style={{ color: col(complaintStatus) }}>
            {DOMAIN.complaintRate}%
          </Num>
          <div className="flex items-center justify-between mt-1.5">
            <span className="flex items-center gap-1 text-xs" style={{ color: col(complaintStatus) }}>
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: col(complaintStatus) }}
              />
              {lbl(complaintStatus)}
            </span>
            <span className="text-xs text-muted-foreground">
              ambang <Num>0,1%</Num>
            </span>
          </div>
        </div>

        {/* Tahap pemanasan */}
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
              {DOMAIN.warmupStage}
            </Num>
            <Num className="text-sm text-muted-foreground">/ {DOMAIN.warmupTotal}</Num>
          </div>
          <div className="flex gap-1 mt-2">
            {Array.from({ length: DOMAIN.warmupTotal }).map((_, i) => (
              <div
                key={i}
                className="flex-1 h-1.5 rounded-sm"
                style={{
                  backgroundColor: i < DOMAIN.warmupStage ? "#c4824a" : "rgba(196,130,74,0.18)",
                }}
              />
            ))}
          </div>
        </div>

        {/* Kirim hari ini */}
        <div
          className="rounded-sm p-3"
          style={{
            backgroundColor: "rgba(100,140,180,0.07)",
            border: "1px solid rgba(100,140,180,0.12)",
          }}
        >
          <PanelLabel className="mb-1">Kirim hari ini</PanelLabel>
          <div className="flex items-baseline gap-1">
            <Num className="text-2xl font-semibold text-foreground">{DOMAIN.sentToday}</Num>
            <Num className="text-sm text-muted-foreground">/ {DOMAIN.dailyLimit}</Num>
          </div>
          <div className="mt-2">
            <div
              className="h-1.5 rounded-sm overflow-hidden"
              style={{ backgroundColor: "rgba(100,140,180,0.15)" }}
            >
              <div
                className="h-full rounded-sm"
                style={{
                  width: `${sentPct}%`,
                  backgroundColor: sentPct > 80 ? "#d4a040" : "#8da0b8",
                }}
              />
            </div>
            <div className="flex justify-between mt-1 text-xs text-muted-foreground">
              <span>
                <Num>{DAILY_REMAINING.toLocaleString("id-ID")}</Num> tersisa
              </span>
              <Num>{sentPct.toFixed(0)}%</Num>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
