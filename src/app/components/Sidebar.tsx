import type React from "react";
import { Activity, BarChart2, Database, Mail, Repeat, Send, Upload, Users } from "lucide-react";
import { useDomainHealth } from "../lib/domainHealth";
import type { Screen } from "../lib/types";
import { Mono, Num } from "./Typography";

const NAV: { id: Screen; icon: React.ElementType; label: string }[] = [
  { id: "dashboard",   icon: Activity,  label: "Dasbor"        },
  { id: "import",      icon: Upload,    label: "Impor Kontak"  },
  { id: "contacts",    icon: Users,     label: "Daftar Kontak" },
  { id: "builder",     icon: Send,      label: "Buat Kampanye" },
  { id: "followup",    icon: Repeat,    label: "Tindak Lanjut" },
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
  const { data } = useDomainHealth();

  const bounce = data?.reputation.bounce_rate_7d ?? null;
  const keluhan = data?.reputation.complaint_rate_7d ?? null;
  const ambang = data?.reputation.thresholds;

  // Titik indikator: hijau HANYA kalau metriknya benar-benar terukur dan aman.
  // Belum terukur ditandai netral, bukan hijau — sinyal hijau pada data yang
  // tidak ada adalah kebohongan yang paling mudah dipercaya.
  const terukur = bounce !== null && keluhan !== null && Boolean(ambang);
  const aman =
    terukur && bounce < ambang!.bounce.perhatian && keluhan < ambang!.keluhan.perhatian;
  const warnaTitik = !terukur ? "#6a82a0" : aman ? "#5cc9a0" : "#d4a040";

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
            style={{ backgroundColor: warnaTitik }}
          />
          <Mono className="text-xs text-muted-foreground truncate" title={data?.domain}>
            {data?.domain ?? "memuat…"}
          </Mono>
        </div>
        <div className="space-y-1">
          {[
            {
              label: "Bounce",
              val: bounce === null ? "—" : `${bounce}%`,
              warna: bounce === null ? "#6a82a0" : bounce < ambang!.bounce.perhatian ? "#5cc9a0" : "#d4a040",
            },
            {
              label: "Keluhan",
              val: keluhan === null ? "—" : `${keluhan}%`,
              warna: keluhan === null ? "#6a82a0" : keluhan < ambang!.keluhan.perhatian ? "#5cc9a0" : "#d4a040",
            },
            {
              label: "Pemanasan",
              val: data ? `${data.warmup.stage}/${data.warmup.total_stages}` : "—",
              warna: "#c4824a",
            },
          ].map((m) => (
            <div key={m.label} className="flex justify-between text-xs">
              <span className="text-muted-foreground">{m.label}</span>
              <Num style={{ color: m.warna }}>{m.val}</Num>
            </div>
          ))}
        </div>
        {!terukur && data && (
          <p className="text-xs mt-2 leading-relaxed" style={{ color: "#4d5f78" }}>
            Belum ada pengiriman, jadi bounce dan keluhan belum terukur.
          </p>
        )}
      </div>
    </div>
  );
}
