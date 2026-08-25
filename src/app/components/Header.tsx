import { SENDER } from "../lib/mock";
import type { Screen } from "../lib/types";
import { Num } from "./Typography";

const TITLES: Record<Screen, string> = {
  dashboard:   "DASBOR",
  import:      "IMPOR KONTAK",
  contacts:    "DAFTAR KONTAK",
  builder:     "BUAT KAMPANYE",
  report:      "LAPORAN KAMPANYE",
  suppression: "DAFTAR SUPPRES",
};

const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function Header({ screen }: { screen: Screen }) {
  return (
    <div
      className="h-11 border-b border-border flex items-center justify-between px-6 flex-shrink-0"
      style={{ backgroundColor: "#0a1018" }}
    >
      <span
        className="text-xs uppercase tracking-widest font-semibold"
        style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          letterSpacing: "0.14em",
          color: "#dce3ec",
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
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded-sm flex items-center justify-center text-xs font-semibold flex-shrink-0"
            style={{ backgroundColor: "rgba(196,130,74,0.18)", color: "#c4824a" }}
          >
            {initials(SENDER.name)}
          </div>
          <span className="text-xs text-muted-foreground">{SENDER.name}</span>
        </div>
      </div>
    </div>
  );
}
