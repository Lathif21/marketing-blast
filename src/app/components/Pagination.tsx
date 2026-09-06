import type React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Num } from "./Typography";

export const PER_PAGE_OPTIONS = [25, 50, 100] as const;

/**
 * Daftar nomor halaman yang ditampilkan, dengan `null` sebagai penanda elipsis.
 *
 * Halaman pertama dan terakhir selalu ikut supaya lompatan ke ujung selalu
 * tersedia — pada 1.815 kontak, "halaman terakhir" adalah tujuan yang nyata,
 * bukan sekadar kelengkapan.
 */
export function nomorHalaman(page: number, totalPages: number): (number | null)[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const sekitar = [page - 1, page, page + 1].filter((n) => n > 1 && n < totalPages);
  const inti = [1, ...sekitar, totalPages];

  const hasil: (number | null)[] = [];
  for (let i = 0; i < inti.length; i++) {
    // Selisih lebih dari satu berarti ada halaman yang dilewati.
    if (i > 0 && inti[i] - inti[i - 1] > 1) hasil.push(null);
    hasil.push(inti[i]);
  }
  return hasil;
}

interface Props {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
  /** Menahan klik selagi permintaan sebelumnya belum selesai. */
  disabled?: boolean;
  /** Satuan yang dihitung, misalnya "kontak". */
  satuan?: string;
}

export function Pagination({
  page,
  perPage,
  total,
  onPageChange,
  onPerPageChange,
  disabled = false,
  satuan = "baris",
}: Props) {
  const totalPages = Math.max(Math.ceil(total / perPage), 1);

  // Tidak ada yang perlu dinavigasi kalau semuanya muat di satu halaman —
  // tapi pemilih jumlah per halaman tetap berguna, jadi barisnya tidak
  // disembunyikan sepenuhnya.
  const dari = total === 0 ? 0 : (page - 1) * perPage + 1;
  const sampai = Math.min(page * perPage, total);

  const fmt = (n: number) => n.toLocaleString("id-ID");

  const tombol = (
    isi: React.ReactNode,
    kePage: number,
    aktif = false,
    label?: string,
  ) => {
    const mati = disabled || kePage < 1 || kePage > totalPages || kePage === page;
    return (
      <button
        onClick={() => !mati && onPageChange(kePage)}
        disabled={mati}
        aria-label={label}
        aria-current={aktif ? "page" : undefined}
        className="min-w-[26px] h-[26px] px-1.5 rounded-sm text-xs transition-colors flex items-center justify-center"
        style={{
          backgroundColor: aktif ? "var(--primary)" : "transparent",
          color: aktif ? "var(--primary-foreground)" : mati ? "var(--samar)" : "var(--secondary-foreground)",
          border: `1px solid ${aktif ? "var(--primary)" : "rgb(var(--kabut-rgb) / 0.12)"}`,
          cursor: mati ? "default" : "pointer",
        }}
      >
        {isi}
      </button>
    );
  };

  return (
    <div className="flex items-center justify-between gap-4 mt-3 flex-wrap">
      <p className="text-xs text-muted-foreground">
        {total === 0 ? (
          <>Tidak ada {satuan} untuk ditampilkan</>
        ) : (
          <>
            Menampilkan <Num>{fmt(dari)}</Num>–<Num>{fmt(sampai)}</Num> dari{" "}
            <Num className="text-foreground">{fmt(total)}</Num> {satuan}
          </>
        )}
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Per halaman
          <select
            value={perPage}
            disabled={disabled}
            onChange={(e) => onPerPageChange(Number(e.target.value))}
            className="bg-card border border-border rounded-sm px-1.5 py-1 text-xs text-foreground outline-none font-mono tabular-nums"
          >
            {PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            {tombol(<ChevronLeft size={13} />, page - 1, false, "Halaman sebelumnya")}

            {nomorHalaman(page, totalPages).map((n, i) =>
              n === null ? (
                <span key={`gap-${i}`} className="px-1 text-xs" style={{ color: "var(--samar)" }}>
                  …
                </span>
              ) : (
                <span key={n}>{tombol(<Num>{n}</Num>, n, n === page, `Halaman ${n}`)}</span>
              ),
            )}

            {tombol(<ChevronRight size={13} />, page + 1, false, "Halaman berikutnya")}
          </div>
        )}
      </div>
    </div>
  );
}
