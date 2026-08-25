// Penegak Revisi 1 (05-revisi-desain.md): monospace hanya untuk tiga hal.
//
//   <Num>   angka dan metrik      — 1.847, 1,8%, 313/500
//   <Mono>  alamat email, domain, pengenal teknis, nama berkas
//   sisanya prosa, memakai Inter dari <body>
//
// Kalau perlu monospace di luar dua komponen ini, kemungkinan besar teksnya
// prosa dan seharusnya tidak monospace.

import type React from "react";

interface SpanProps {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

/** Angka dan metrik. `tabular-nums` supaya kolom angka tetap sejajar saat dipindai. */
export function Num({ children, className = "", style, title }: SpanProps) {
  return (
    <span className={`font-mono tabular-nums ${className}`} style={style} title={title}>
      {children}
    </span>
  );
}

/** Alamat email, domain, pengenal teknis, nama berkas. */
export function Mono({ children, className = "", style, title }: SpanProps) {
  return (
    <span className={`font-mono ${className}`} style={style} title={title}>
      {children}
    </span>
  );
}

/** Judul kecil di dalam kartu. Prosa — huruf kapital, bukan monospace. */
export function PanelLabel({
  children,
  sub,
  className = "",
}: {
  children: React.ReactNode;
  sub?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div
        className="text-xs uppercase font-medium"
        style={{ color: "#6a82a0", letterSpacing: "0.06em" }}
      >
        {children}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
