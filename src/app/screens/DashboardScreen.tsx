import { AlertCircle } from "lucide-react";
import { EmptyRow, ErrorRow, LoadingRow } from "../components/AsyncState";
import { DomainHealthPanel } from "../components/DomainHealthPanel";
import { SectionTitle } from "../components/SectionTitle";
import { Th } from "../components/Th";
import { Num, PanelLabel } from "../components/Typography";
import { getContactDistribution } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import type { Screen } from "../lib/types";

/** Warna dan penjelasan tiap kelompok status. Bukan data — hanya penyajian. */
const KELOMPOK = [
  { key: "aktif" as const,     label: "Aktif",                 color: "#5cc9a0", bar: "#2b7a5a", sub: "Siap dikirim" },
  { key: "karantina" as const, label: "Karantina",             color: "#d4a040", bar: "#92680a", sub: "Perlu verifikasi alamat" },
  { key: "diblokir" as const,  label: "Diblokir / Suppressed",  color: "#e05252", bar: "#8c2e2e", sub: "Tidak dapat dikirim" },
];

export function DashboardScreen({ onNavigate }: { onNavigate: (s: Screen) => void }) {
  const { status, data, error, reload } = useAsync(() => getContactDistribution(), []);

  const total = data ? data.aktif + data.karantina + data.diblokir : 0;

  return (
    <div className="p-6">
      <DomainHealthPanel />

      <div className="grid grid-cols-3 gap-5">
        {/* Kampanye terakhir */}
        <div className="col-span-2 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <SectionTitle label="Kampanye Terakhir" />
          </div>
          <div className="bg-card border border-border rounded-sm overflow-hidden">
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
            </table>
            {/*
              Tabel kampanye sengaja kosong, bukan berisi contoh.
              Penyusunan dan pengiriman kampanye belum dibangun — tabel
              `campaigns` bahkan belum ada. Mengisinya dengan baris contoh akan
              menampilkan tingkat buka dan klik yang terlihat nyata pada layar
              pertama, dan itu jenis kekeliruan yang paling mahal saat produk
              didemokan.
            */}
            <EmptyRow
              title="Belum ada kampanye"
              hint="Penyusunan dan pengiriman kampanye dibangun setelah domain pengirim dan Amazon SES aktif. Sampai saat itu tabel ini kosong — bukan karena gagal dimuat."
            />
          </div>

          <div className="flex items-start gap-2 mt-2">
            <AlertCircle size={12} style={{ color: "#6a82a0", flexShrink: 0, marginTop: 2 }} />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Yang sudah dapat dikerjakan sekarang: mengimpor kontak dan melihat daftar penekanan.
              Keduanya membaca data sungguhan.
            </p>
          </div>
        </div>

        {/* Distribusi kontak — nyata, dari GET /contacts/distribution */}
        <div>
          <SectionTitle label="Distribusi Kontak" />

          {status === "gagal" && !data ? (
            <div className="bg-card border border-border rounded-sm">
              <ErrorRow message={error} onRetry={reload} />
            </div>
          ) : !data ? (
            <div className="bg-card border border-border rounded-sm">
              <LoadingRow />
            </div>
          ) : total === 0 ? (
            <div className="bg-card border border-border rounded-sm">
              <EmptyRow
                title="Belum ada kontak"
                hint="Impor daftar kontak untuk mulai. Angka di sini dihitung langsung dari basis data."
                action={
                  <button
                    onClick={() => onNavigate("import")}
                    className="px-3 py-1.5 text-xs rounded-sm"
                    style={{ backgroundColor: "#c4824a", color: "#fff" }}
                  >
                    Impor Kontak
                  </button>
                }
              />
            </div>
          ) : (
            <div className="space-y-2">
              {KELOMPOK.map((k) => (
                <button
                  key={k.key}
                  type="button"
                  onClick={() => onNavigate("contacts")}
                  className="w-full text-left bg-card border border-border rounded-sm p-3 transition-colors hover:bg-secondary/20"
                  style={{ borderLeftWidth: "3px", borderLeftColor: k.color }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{k.label}</span>
                    <Num className="text-lg font-semibold" style={{ color: k.color }}>
                      {data[k.key].toLocaleString("id-ID")}
                    </Num>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{k.sub}</p>
                </button>
              ))}

              <div className="bg-card border border-border rounded-sm p-3 mt-1">
                <PanelLabel className="mb-2">Komposisi</PanelLabel>
                <div className="flex h-2 rounded-sm overflow-hidden gap-px">
                  {KELOMPOK.filter((k) => data[k.key] > 0).map((k) => (
                    <div key={k.key} style={{ flex: data[k.key], backgroundColor: k.bar }} />
                  ))}
                </div>
                <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
                  <span>
                    <Num>{((data.aktif / total) * 100).toFixed(1)}%</Num> aktif
                  </span>
                  <span>
                    <Num>{total.toLocaleString("id-ID")}</Num> total
                  </span>
                </div>
              </div>

              {data.aktif === 0 && data.karantina > 0 && (
                <p className="text-xs text-muted-foreground leading-relaxed pt-1">
                  Seluruh kontak berstatus karantina. Itu memang keadaan yang benar setelah impor:
                  alamat wajib lolos verifikasi sebelum dapat dikirimi, dan verifikasi alamat belum
                  dibangun.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
