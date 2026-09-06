// Pengalih mode terang/gelap.
//
// Satu tombol yang berputar melalui tiga keadaan, bukan sakelar dua posisi.
// Sakelar dua posisi memaksa memilih antara terang dan gelap, dan menghilangkan
// pilihan yang paling sering benar: ikut setelan perangkat. Pengguna yang
// perangkatnya berpindah sendiri saat malam tidak perlu menyentuh apa pun.
//
// Ikonnya menunjukkan keadaan yang SEDANG berlaku, bukan keadaan berikutnya —
// tombol yang menampilkan bulan saat mode terang aktif terbaca sebagai
// "sekarang gelap" oleh sebagian orang dan "klik untuk gelap" oleh sebagian
// lain. Yang dituju berikutnya dijelaskan lewat tooltip.

import { Monitor, Moon, Sun } from "lucide-react";
import { useTema, type Tema } from "../lib/tema";

const BERIKUTNYA: Record<Tema, Tema> = {
  sistem: "terang",
  terang: "gelap",
  gelap: "sistem",
};

const LABEL: Record<Tema, string> = {
  sistem: "Mengikuti setelan perangkat",
  terang: "Mode terang",
  gelap: "Mode gelap",
};

export function PengalihTema({ className = "" }: { className?: string }) {
  const { tema, setel } = useTema();
  const Ikon = tema === "sistem" ? Monitor : tema === "terang" ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={() => setel(BERIKUTNYA[tema])}
      className={`text-muted-foreground hover:text-foreground transition-colors ${className}`}
      title={`${LABEL[tema]} — klik untuk ${LABEL[BERIKUTNYA[tema]].toLowerCase()}`}
      aria-label={`Tampilan: ${LABEL[tema]}. Klik untuk ganti.`}
    >
      <Ikon size={12} />
    </button>
  );
}
