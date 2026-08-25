// Label status adalah prosa, jadi Inter — bukan monospace (Revisi 1).
// Warna dan teks tetap dipakai bersamaan; warna saja tidak cukup.

const MAP: Record<string, { label: string; color: string; bg: string }> = {
  aktif:     { label: "Aktif",     color: "#5cc9a0", bg: "rgba(43,122,90,0.2)"    },
  karantina: { label: "Karantina", color: "#d4a040", bg: "rgba(180,120,30,0.15)"  },
  diblokir:  { label: "Diblokir",  color: "#e05252", bg: "rgba(140,46,46,0.2)"    },
  selesai:   { label: "Selesai",   color: "#8da0b8", bg: "rgba(106,130,160,0.15)" },
  draft:     { label: "Draft",     color: "#6a82a0", bg: "rgba(100,130,160,0.1)"  },
};

const FALLBACK = { color: "#6a82a0", bg: "rgba(100,130,160,0.1)" };

export function StatusBadge({ status }: { status: string }) {
  const c = MAP[status] ?? { label: status, ...FALLBACK };
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-sm border"
      style={{ color: c.color, backgroundColor: c.bg, borderColor: `${c.color}30` }}
    >
      <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
      {c.label}
    </span>
  );
}
