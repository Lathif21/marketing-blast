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

/**
 * Teks panjang yang dipotong dengan elipsis, dengan teks utuh tetap dapat
 * dibaca lewat tooltip.
 *
 * Tiga hal yang membuatnya perlu jadi komponen sendiri:
 *
 * 1. `truncate` yang dipasang langsung pada `<td>` tidak dapat diandalkan —
 *    `table-layout: auto` mengabaikan `max-width` pada sel. Pemotongan harus
 *    terjadi pada elemen blok DI DALAM sel.
 * 2. `title` wajib ikut. Memotong teks tanpa menyediakan cara melihat versi
 *    utuhnya berarti menghilangkan informasi, dan nama perusahaan adalah hal
 *    yang justru dicari pengguna saat memindai tabel.
 * 3. Tinggi baris jadi seragam, yang menjaga kerapatan tabel — dan kerapatan
 *    itu fitur, bukan kebetulan (05-revisi-desain.md).
 */
export function Truncate({
  children,
  maxWidth,
  className = "",
}: {
  children: string;
  /** Lebar maksimum sebelum dipotong, misalnya `"240px"`. */
  maxWidth: string;
  className?: string;
}) {
  return (
    <div
      className={`truncate ${className}`}
      style={{ maxWidth }}
      title={children}
    >
      {children}
    </div>
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
