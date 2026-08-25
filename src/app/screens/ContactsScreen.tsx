import { useState } from "react";
import { AlertTriangle, Eye, Search } from "lucide-react";
import { SectionTitle } from "../components/SectionTitle";
import { StatusBadge } from "../components/StatusBadge";
import { Th } from "../components/Th";
import { Mono, Num } from "../components/Typography";
import { CONTACTS, QUARANTINE_REASON } from "../lib/mock";

const FILTERS = ["semua", "aktif", "karantina", "diblokir"] as const;

export function ContactsScreen() {
  const [statusFilter, setStatusFilter] = useState<string>("semua");
  const [search, setSearch] = useState("");

  const filtered = CONTACTS.filter((c) => {
    if (statusFilter !== "semua" && c.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!c.company.toLowerCase().includes(q) && !c.email.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const countBy = (s: string) => CONTACTS.filter((c) => c.status === s).length;

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <SectionTitle label="Daftar Kontak" />
          <p className="text-xs text-muted-foreground -mt-3">
            <Num>{countBy("aktif")}</Num> aktif · <Num>{countBy("karantina")}</Num> karantina ·{" "}
            <Num>{countBy("diblokir")}</Num> diblokir
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="Cari perusahaan atau email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-card border border-border rounded-sm pl-7 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none w-64"
              style={{ caretColor: "#c4824a" }}
            />
          </div>
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className="px-2.5 py-1.5 text-xs rounded-sm capitalize transition-all"
                style={{
                  backgroundColor: statusFilter === f ? "#c4824a" : "rgba(100,140,180,0.07)",
                  color: statusFilter === f ? "#fff" : "#8da0b8",
                  border: `1px solid ${statusFilter === f ? "#c4824a" : "rgba(100,140,180,0.12)"}`,
                }}
              >
                {f === "semua" ? "Semua" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <Th>Perusahaan</Th>
              <Th>Email</Th>
              <Th>Sumber Izin</Th>
              <Th>Status</Th>
              <Th>Tanggal Impor</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr
                key={c.id}
                className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors"
                style={{
                  backgroundColor:
                    c.status === "karantina"
                      ? "rgba(180,120,30,0.05)"
                      : c.status === "diblokir"
                        ? "rgba(140,46,46,0.05)"
                        : undefined,
                  borderLeft:
                    c.status === "karantina"
                      ? "2px solid rgba(212,160,64,0.45)"
                      : c.status === "diblokir"
                        ? "2px solid rgba(224,82,82,0.45)"
                        : "2px solid transparent",
                }}
              >
                <td className="px-3 py-2 font-medium text-foreground">{c.company}</td>
                <td className="px-3 py-2">
                  <Mono className="text-muted-foreground">{c.email}</Mono>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{c.consent}</td>
                <td className="px-3 py-2">
                  {/*
                    Peringatan dipicu asal alamat, bukan sumber izin. Alamat hasil
                    tebakan adalah penyebab utama pemantulan keras — itulah yang
                    membuat kontak dikarantina (04-aturan-kepatuhan.md §4).
                  */}
                  <span className="inline-flex items-center gap-1.5">
                    <StatusBadge status={c.status} />
                    {c.emailOrigin === "guessed" && (
                      <span className="inline-flex" title={QUARANTINE_REASON}>
                        <AlertTriangle size={11} style={{ color: "#d4a040", flexShrink: 0 }} />
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Num className="text-muted-foreground">{c.date}</Num>
                </td>
                <td className="px-3 py-2">
                  <button className="text-muted-foreground hover:text-foreground transition-colors">
                    <Eye size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-10 text-center text-xs text-muted-foreground">
            Tidak ada kontak yang cocok.
          </div>
        )}
      </div>
    </div>
  );
}
