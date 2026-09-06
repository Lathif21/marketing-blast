// Tiga keadaan yang harus ditangani setiap layar yang mengambil data.
//
// Keadaan kosong adalah ajakan bertindak, bukan tulisan "tidak ada data" —
// pengguna yang baru memasang produk ini akan melihatnya lebih dulu daripada
// tampilan yang terisi.

import type React from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

export function LoadingRow({ label = "Memuat…" }: { label?: string }) {
  return (
    <div className="py-10 flex items-center justify-center gap-2 text-xs text-muted-foreground">
      <Loader2 size={13} className="animate-spin" />
      {label}
    </div>
  );
}

export function ErrorRow({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="py-8 px-4 flex flex-col items-center gap-2 text-center">
      <AlertTriangle size={16} style={{ color: "var(--bahaya)" }} />
      <p className="text-xs" style={{ color: "var(--bahaya)" }}>
        Data tidak dapat dimuat
      </p>
      <p className="text-xs text-muted-foreground max-w-md">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 px-3 py-1.5 text-xs border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Coba lagi
        </button>
      )}
    </div>
  );
}

export function EmptyRow({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="py-10 px-4 flex flex-col items-center gap-2 text-center">
      <p className="text-xs text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground max-w-md">{hint}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
