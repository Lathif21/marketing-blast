import { Download, Lock, Shield } from "lucide-react";
import { SectionTitle } from "../components/SectionTitle";
import { Th } from "../components/Th";
import { Mono, Num } from "../components/Typography";
import { SUPPRESSION } from "../lib/mock";
import type { SuppressionType } from "../lib/types";

const TYPE_STYLE: Record<SuppressionType, { color: string; bg: string }> = {
  Keluhan:       { color: "#e05252", bg: "rgba(140,46,46,0.2)"    },
  "Hard Bounce": { color: "#d4a040", bg: "rgba(180,120,30,0.15)"  },
  Manual:        { color: "#8da0b8", bg: "rgba(100,130,160,0.1)"  },
  Unsubscribe:   { color: "#8da0b8", bg: "rgba(100,130,160,0.1)"  },
};

export function SuppressionScreen() {
  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <SectionTitle label="Daftar Suppres" />
          <p className="text-xs text-muted-foreground -mt-3">
            <Num>{SUPPRESSION.length}</Num> entri · Hanya baca · Tidak dapat diubah atau dihapus
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
          melindungi reputasi domain.
        </p>
      </div>

      <div className="bg-card border border-border rounded-sm overflow-hidden">
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
            {SUPPRESSION.map((item) => {
              const style = TYPE_STYLE[item.type];
              return (
                <tr key={item.email} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <Mono className="text-muted-foreground">{item.email}</Mono>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{item.reason}</td>
                  <td className="px-3 py-2">
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 text-xs rounded-sm"
                      style={{ backgroundColor: style.bg, color: style.color }}
                    >
                      {item.type}
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
      </div>
    </div>
  );
}
