import type React from "react";

/** Kepala kolom tabel. Prosa, jadi Inter — bukan monospace (Revisi 1). */
export function Th({
  children,
  align = "left",
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-3 py-2.5 text-label font-semibold uppercase tracking-wider whitespace-nowrap ${
        align === "right" ? "text-right" : "text-left"
      }`}
      style={{ color: "var(--muted-foreground)" }}
    >
      {children}
    </th>
  );
}
