// Label status adalah prosa, jadi Inter — bukan monospace (Revisi 1).
// Warna dan teks tetap dipakai bersamaan; warna saja tidak cukup.

const MAP: Record<string, { label: string; color: string; bg: string }> = {
  aktif:     { label: "Aktif",     color: "var(--sukses)", bg: "rgb(var(--sukses-rgb) / 0.2)"    },
  karantina: { label: "Karantina", color: "var(--peringatan)", bg: "rgb(var(--peringatan-rgb) / 0.15)"  },
  diblokir:  { label: "Diblokir",  color: "var(--bahaya)", bg: "rgb(var(--bahaya-rgb) / 0.2)"    },
  selesai:   { label: "Selesai",   color: "var(--secondary-foreground)", bg: "rgb(var(--kabut-rgb) / 0.15)" },
  draft:     { label: "Draft",     color: "var(--muted-foreground)", bg: "rgb(var(--kabut-rgb) / 0.1)"  },
};

const FALLBACK = { color: "var(--muted-foreground)", bg: "rgb(var(--kabut-rgb) / 0.1)" };

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
