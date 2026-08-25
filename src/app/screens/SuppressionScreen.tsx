import { Download, Lock, Shield } from "lucide-react";
import { EmptyRow, ErrorRow, LoadingRow } from "../components/AsyncState";
import { SectionTitle } from "../components/SectionTitle";
import { Th } from "../components/Th";
import { Mono, Num } from "../components/Typography";
import { listSuppression } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import {
  SUPPRESSION_LABELS,
  SUPPRESSION_TEXT,
  type SuppressionReason,
} from "../lib/types";

const REASON_STYLE: Record<SuppressionReason, { color: string; bg: string }> = {
  keluhan:     { color: "#e05252", bg: "rgba(140,46,46,0.2)"   },
  hard_bounce: { color: "#d4a040", bg: "rgba(180,120,30,0.15)" },
  manual:      { color: "#8da0b8", bg: "rgba(100,130,160,0.1)" },
  unsubscribe: { color: "#8da0b8", bg: "rgba(100,130,160,0.1)" },
};

export function SuppressionScreen() {
  const { status, data, error, reload } = useAsync(() => listSuppression(1, 100), []);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <SectionTitle label="Daftar Suppres" />
          <p className="text-xs text-muted-foreground -mt-3">
            {data ? (
              <>
                <Num>{total.toLocaleString("id-ID")}</Num> entri ·{" "}
              </>
            ) : null}
            Hanya baca · Tidak dapat diubah atau dihapus
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="px-3 py-1.5 rounded-sm text-xs flex items-center gap-1.5"
            style={{
              backgroundColor: "rgba(140,46,46,0.15)",
              color: "#e05252",
              border: "1px solid rgba(224,82,82,0.2)",
            }}
          >
            <Lock size={11} /> Daftar Permanen
          </div>
          <button className="text-xs flex items-center gap-1.5 border border-border rounded-sm px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors">
            <Download size={12} /> Export CSV
          </button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-sm p-3 mb-4 flex items-start gap-2">
        <Shield size={13} style={{ color: "#c4824a", flexShrink: 0, marginTop: 1 }} />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Email dalam daftar ini{" "}
          <strong className="text-foreground">
            tidak akan pernah menerima kampanye dari domain Anda
          </strong>
          , terlepas dari segmen yang dipilih. Daftar ini dikelola otomatis oleh sistem untuk
          melindungi reputasi domain, dan tidak memiliki operasi hapus di lapisan mana pun.
        </p>
      </div>

      <div className="bg-card border border-border rounded-sm overflow-hidden">
        {status === "gagal" && items.length === 0 ? (
          <ErrorRow message={error} onRetry={reload} />
        ) : status === "memuat" && items.length === 0 ? (
          <LoadingRow />
        ) : items.length === 0 ? (
          <EmptyRow
            title="Belum ada alamat yang ditekan"
            hint="Daftar ini terisi sendiri saat penerima berhenti berlangganan, alamat memantul keras, atau ada laporan spam. Kosong berarti belum ada kampanye yang menghasilkan salah satunya."
          />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <Th>Email</Th>
                <Th>Alasan</Th>
                <Th>Tipe</Th>
                <Th>Tanggal Ditambahkan</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const style = REASON_STYLE[item.reason];
                return (
                  <tr key={item.email} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <Mono className="text-muted-foreground">{item.email}</Mono>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {SUPPRESSION_TEXT[item.reason]}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-flex items-center px-1.5 py-0.5 text-xs rounded-sm"
                        style={{ backgroundColor: style.bg, color: style.color }}
                      >
                        {SUPPRESSION_LABELS[item.reason]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Num className="text-muted-foreground">{item.date}</Num>
                    </td>
                    <td className="px-3 py-2">
                      {/* Tidak ada aksi hapus di sini, dan tidak boleh ditambahkan. */}
                      <Lock size={11} className="text-muted-foreground opacity-50" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {status === "gagal" && items.length > 0 && (
        <p className="mt-2 text-xs" style={{ color: "#d4a040" }}>
          Gagal menyegarkan: {error}. Yang tampil di atas adalah data terakhir yang berhasil dimuat.
        </p>
      )}
    </div>
  );
}
