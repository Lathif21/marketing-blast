import { LogOut } from "lucide-react";
import { PengalihTema } from "./PengalihTema";
import type { SesiSaya } from "../lib/api";
import type { Screen } from "../lib/types";
import { Mono, Num } from "./Typography";

const TITLES: Record<Screen, string> = {
  dashboard:   "DASBOR",
  import:      "IMPOR KONTAK",
  contacts:    "DAFTAR KONTAK",
  builder:     "BUAT KAMPANYE",
  followup:    "TINDAK LANJUT",
  report:      "LAPORAN KAMPANYE",
  superadmin:  "KENDALI PELANGGAN",
  suppression: "DAFTAR SUPPRES",
};

const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function Header({
  screen,
  sesi,
  onKeluar,
}: {
  screen: Screen;
  sesi?: SesiSaya | null;
  onKeluar?: () => void;
}) {
  // Nama pelanggan ikut ditampilkan, bukan hanya nama pengguna. Superadmin
  // yang berimpersonasi perlu tahu ia sedang berada di akun siapa setiap saat,
  // dan bilah impersonasi bisa tergulir hilang di layar yang panjang.
  const pelanggan = sesi?.tenant?.nama ?? null;
  return (
    <div
      className="h-12 border-b border-border flex items-center justify-between px-6 flex-shrink-0"
      style={{ backgroundColor: "var(--sidebar)" }}
    >
      <span
        className="text-base uppercase tracking-widest font-semibold"
        style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          letterSpacing: "0.14em",
          color: "var(--foreground)",
        }}
      >
        {TITLES[screen]}
      </span>
      <div className="flex items-center gap-4">
        <Num className="text-xs text-muted-foreground">
          {new Date().toLocaleDateString("id-ID", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </Num>
        {pelanggan && (
          <Mono className="text-xs" style={{ color: "var(--muted-foreground)" }} title="Pelanggan yang sedang dibuka">
            {pelanggan}
          </Mono>
        )}
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-sm flex items-center justify-center text-xs font-semibold flex-shrink-0"
            style={{ backgroundColor: "rgb(var(--primary-rgb) / 0.18)", color: "var(--primary)" }}
            title={sesi?.peran}
          >
            {initials(sesi?.nama ?? "?")}
          </div>
          <span className="text-xs text-muted-foreground">{sesi?.nama ?? "—"}</span>
          <PengalihTema className="ml-1" />
          {onKeluar && (
            <button
              onClick={onKeluar}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
              title="Keluar"
            >
              <LogOut size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
