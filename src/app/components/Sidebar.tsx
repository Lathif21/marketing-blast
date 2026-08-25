import type React from "react";
import { Activity, BarChart2, Database, Mail, Send, Upload, Users } from "lucide-react";
import { DOMAIN } from "../lib/mock";
import type { Screen } from "../lib/types";
import { Mono, Num } from "./Typography";

const NAV: { id: Screen; icon: React.ElementType; label: string }[] = [
  { id: "dashboard",   icon: Activity,  label: "Dasbor"        },
  { id: "import",      icon: Upload,    label: "Impor Kontak"  },
  { id: "contacts",    icon: Users,     label: "Daftar Kontak" },
  { id: "builder",     icon: Send,      label: "Buat Kampanye" },
  { id: "report",      icon: BarChart2, label: "Laporan"       },
  { id: "suppression", icon: Database,  label: "Daftar Suppres" },
];

export function Sidebar({
  screen,
  onNavigate,
}: {
  screen: Screen;
  onNavigate: (s: Screen) => void;
}) {
  const bounceOk = DOMAIN.bounceRate < 2;
  const complaintOk = DOMAIN.complaintRate < 0.1;
  const overall = bounceOk && complaintOk;

  return (
    <div
      className="w-52 flex flex-col border-r border-border flex-shrink-0"
      style={{ backgroundColor: "#0a1018" }}
    >
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
          style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            letterSpacing: "0.12em",
            color: "#dce3ec",
            fontSize: "13px",
          }}
        >
          Marketing Blast
        </span>
      </div>

      {/* Navigasi */}
      <nav className="flex-1 py-2">
        {NAV.map(({ id, icon: Icon, label }) => {
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
              <span className="text-xs">{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Ringkasan kesehatan domain */}
      <div className="px-4 py-3.5 border-t border-border">
        <div className="flex items-center gap-1.5 mb-2">
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: overall ? "#5cc9a0" : "#d4a040" }}
          />
          <Mono className="text-xs text-muted-foreground truncate" title={DOMAIN.name}>
            {DOMAIN.name}
          </Mono>
        </div>
        <div className="space-y-1">
          {[
            { label: "Bounce",    val: `${DOMAIN.bounceRate}%`,    ok: bounceOk,    copper: false },
            { label: "Keluhan",   val: `${DOMAIN.complaintRate}%`, ok: complaintOk, copper: false },
            { label: "Pemanasan", val: `${DOMAIN.warmupStage}/${DOMAIN.warmupTotal}`, ok: true, copper: true },
          ].map((m) => (
            <div key={m.label} className="flex justify-between text-xs">
              <span className="text-muted-foreground">{m.label}</span>
              <Num style={{ color: m.copper ? "#c4824a" : m.ok ? "#5cc9a0" : "#d4a040" }}>
                {m.val}
              </Num>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
