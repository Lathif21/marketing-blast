import { DomainHealthPanel } from "../components/DomainHealthPanel";
import { SectionTitle } from "../components/SectionTitle";
import { StatusBadge } from "../components/StatusBadge";
import { Th } from "../components/Th";
import { Mono, Num, PanelLabel, Truncate } from "../components/Typography";
import { CAMPAIGNS, CONTACT_DISTRIBUTION } from "../lib/mock";
import type { Screen } from "../lib/types";

export function DashboardScreen({ onNavigate }: { onNavigate: (s: Screen) => void }) {
  const contactTotal = CONTACT_DISTRIBUTION.reduce((sum, s) => sum + s.count, 0);

  return (
    <div className="p-6">
      <DomainHealthPanel />

      <div className="grid grid-cols-3 gap-5">
        {/* Kampanye terakhir */}
        <div className="col-span-2 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <SectionTitle label="Kampanye Terakhir" />
            <button
              onClick={() => onNavigate("builder")}
              className="text-xs border border-border rounded-sm px-2.5 py-1 transition-colors hover:text-foreground"
              style={{ color: "#8da0b8" }}
            >
              + Buat Kampanye
            </button>
          </div>
          <div className="bg-card border border-border rounded-sm overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <Th>ID</Th>
                  <Th>Kampanye</Th>
                  <Th>Status</Th>
                  <Th align="right">Penerima</Th>
                  <Th align="right">Dibuka</Th>
                  <Th align="right">Diklik</Th>
                  <Th align="right">Bounce</Th>
                  <Th>Tanggal</Th>
                </tr>
              </thead>
              <tbody>
                {CAMPAIGNS.map((c) => {
                  const hasData = c.recipients > 0;
                  const pct = (n: number) => `${((n / c.recipients) * 100).toFixed(1)}%`;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => hasData && onNavigate("report")}
                      className={`border-b border-border last:border-0 transition-colors ${
                        hasData ? "hover:bg-secondary/20 cursor-pointer" : "cursor-default"
                      }`}
                    >
                      <td className="px-3 py-2">
                        <Mono className="text-muted-foreground">{c.id}</Mono>
                      </td>
                      <td className="px-3 py-2 font-medium text-foreground">
                        <Truncate maxWidth="180px">{c.name}</Truncate>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-3 py-2 text-right text-foreground">
                        <Num>{hasData ? c.recipients.toLocaleString("id-ID") : "—"}</Num>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Num style={{ color: hasData ? "#5cc9a0" : undefined }}>
                          {hasData ? pct(c.opened) : "—"}
                        </Num>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Num style={{ color: hasData ? "#c4824a" : undefined }}>
                          {hasData ? pct(c.clicked) : "—"}
                        </Num>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Num style={{ color: hasData && c.bounced > 0 ? "#d4a040" : undefined }}>
                          {hasData ? pct(c.bounced) : "—"}
                        </Num>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Num className="text-muted-foreground">{c.date}</Num>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Distribusi kontak */}
        <div>
          <SectionTitle label="Distribusi Kontak" />
          <div className="space-y-2">
            {CONTACT_DISTRIBUTION.map((s) => (
              <div
                key={s.label}
                className="bg-card border border-border rounded-sm p-3"
                style={{ borderLeftWidth: "3px", borderLeftColor: s.color }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{s.label}</span>
                  <Num className="text-lg font-semibold" style={{ color: s.color }}>
                    {s.count.toLocaleString("id-ID")}
                  </Num>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{s.sub}</p>
              </div>
            ))}

            <div className="bg-card border border-border rounded-sm p-3 mt-1">
              <PanelLabel className="mb-2">Komposisi</PanelLabel>
              <div className="flex h-2 rounded-sm overflow-hidden gap-px">
                {CONTACT_DISTRIBUTION.map((s) => (
                  <div key={s.label} style={{ flex: s.count, backgroundColor: s.bar }} />
                ))}
              </div>
              <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
                <span>
                  <Num>{((CONTACT_DISTRIBUTION[0].count / contactTotal) * 100).toFixed(1)}%</Num>{" "}
                  aktif
                </span>
                <span>
                  <Num>{contactTotal.toLocaleString("id-ID")}</Num> total
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
