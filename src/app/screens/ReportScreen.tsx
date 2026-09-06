import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Download } from "lucide-react";
import { SectionTitle } from "../components/SectionTitle";
import { Num, PanelLabel } from "../components/Typography";
import {
  CAMPAIGNS,
  COMPARISON_DATA,
  FUNNEL,
  REPORT_CAMPAIGN_ID,
  REPORT_HEALTH_IMPACT,
  funnelValue,
} from "../lib/mock";

const MONO_STACK = "'JetBrains Mono', ui-monospace, monospace";
const SANS_STACK = "'Inter', ui-sans-serif, system-ui, sans-serif";

export function ReportScreen() {
  const maxVal = Math.max(...FUNNEL.map((f) => f.value));
  const sent = funnelValue("terkirim");
  const rate = (key: string) => `${((funnelValue(key) / sent) * 100).toFixed(1)}%`;
  const campaign = CAMPAIGNS.find((c) => c.id === REPORT_CAMPAIGN_ID);

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-4">
        <SectionTitle
          label={`Laporan: ${campaign?.name ?? REPORT_CAMPAIGN_ID}`}
          sub={`${REPORT_CAMPAIGN_ID} · ${campaign?.date ?? "—"} · ${sent.toLocaleString("id-ID")} penerima`}
        />
        <button className="text-xs flex items-center gap-1.5 border border-border rounded-sm px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors">
          <Download size={12} /> Unduh PDF
        </button>
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Funnel + perbandingan */}
        <div className="col-span-2 space-y-4">
          <div className="bg-card border border-border rounded-sm p-4">
            <div className="flex items-baseline justify-between mb-4">
              <PanelLabel>Corong pengiriman</PanelLabel>
              <span className="text-xs text-muted-foreground">% terhadap tahap sebelumnya</span>
            </div>
            <div className="space-y-2">
              {FUNNEL.map((item) => {
                const barPct = (item.value / maxVal) * 100;
                const base = item.of ? funnelValue(item.of) : 0;
                const pct = base > 0 ? ((item.value / base) * 100).toFixed(1) : null;
                return (
                  <div key={item.key} className="flex items-center gap-3">
                    <span className="w-36 text-right text-xs text-muted-foreground flex-shrink-0">
                      {item.label}
                    </span>
                    <div className="flex-1 h-7 flex items-center">
                      <div
                        className="h-full rounded-sm flex items-center justify-end pr-2"
                        style={{
                          width: `${barPct}%`,
                          backgroundColor: item.color,
                          minWidth: "2rem",
                        }}
                      >
                        <Num className="text-xs font-medium text-white">
                          {item.value.toLocaleString("id-ID")}
                        </Num>
                      </div>
                    </div>
                    <span className="w-32 text-right text-xs text-muted-foreground flex-shrink-0">
                      {pct === null ? (
                        "—"
                      ) : item.ofLabel ? (
                        <>
                          <Num>{pct}%</Num> {item.ofLabel}
                        </>
                      ) : (
                        <>
                          ↓ <Num>{pct}%</Num>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-card border border-border rounded-sm p-4">
            <PanelLabel className="mb-4">Perbandingan kampanye (%)</PanelLabel>
            <ResponsiveContainer width="100%" height={176}>
              <BarChart
                data={COMPARISON_DATA}
                barGap={2}
                barCategoryGap={20}
                margin={{ top: 4, right: 4, bottom: 0, left: -12 }}
              >
                {/* Sumbu memuat pengenal kampanye dan angka, jadi tetap monospace. */}
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fontFamily: MONO_STACK, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 12, fontFamily: MONO_STACK, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  unit="%"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "1px solid rgb(var(--kabut-rgb) / 0.14)",
                    borderRadius: "2px",
                    fontSize: "13px",
                    fontFamily: SANS_STACK,
                  }}
                  labelStyle={{ color: "var(--foreground)", fontFamily: MONO_STACK }}
                  itemStyle={{ color: "var(--secondary-foreground)" }}
                />
                {/* Label legenda adalah prosa. */}
                <Legend
                  verticalAlign="bottom"
                  height={22}
                  iconSize={8}
                  wrapperStyle={{ fontSize: "12px", fontFamily: SANS_STACK, color: "var(--secondary-foreground)" }}
                />
                <Bar dataKey="buka" name="Dibuka" fill="var(--keterlibatan)" />
                <Bar dataKey="klik" name="Diklik" fill="var(--keterlibatan-kuat)" />
                <Bar dataKey="bounce" name="Bounced" fill="var(--bahaya-kuat)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Panel kanan */}
        <div className="space-y-3">
          <div className="bg-card border border-border rounded-sm p-4">
            <PanelLabel className="mb-3">Dampak kesehatan domain</PanelLabel>
            {REPORT_HEALTH_IMPACT.map((item) => (
              <div
                key={item.label}
                className="mb-3 pb-3 border-b border-border last:border-0 last:mb-0 last:pb-0"
              >
                <div className="flex justify-between mb-0.5">
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                  <Num className="text-xs" style={{ color: item.warn ? "var(--peringatan)" : "var(--sukses)" }}>
                    {item.delta}
                  </Num>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Num className="text-muted-foreground">{item.before}</Num>
                  <span className="text-muted-foreground">→</span>
                  <Num style={{ color: item.warn ? "var(--peringatan)" : "var(--foreground)" }}>{item.after}</Num>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-card border border-border rounded-sm p-4">
            <PanelLabel className="mb-3" sub="% terhadap total terkirim">
              Metrik ringkas
            </PanelLabel>
            {[
              { label: "Terkirim",       value: sent.toLocaleString("id-ID"), color: "var(--foreground)" },
              { label: "Tingkat Buka",   value: rate("dibuka"),               color: "var(--sukses)" },
              { label: "Tingkat Klik",   value: rate("diklik"),               color: "var(--primary)" },
              { label: "Tingkat Bounce", value: rate("bounced"),              color: "var(--peringatan)" },
              { label: "Berhenti Lgg.",  value: rate("unsub"),                color: "var(--bahaya)" },
            ].map((m) => (
              <div key={m.label} className="flex justify-between py-1.5 border-b border-border last:border-0">
                <span className="text-xs text-muted-foreground">{m.label}</span>
                <Num className="text-xs font-semibold" style={{ color: m.color }}>
                  {m.value}
                </Num>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
