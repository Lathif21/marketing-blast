// Satu sumber kesehatan domain untuk seluruh antarmuka.
//
// Panel dasbor, ringkasan di sidebar, dan sisa kuota di penyusun kampanye
// menampilkan angka yang sama. Kalau masing-masing mengambil sendiri, ketiganya
// bisa menampilkan angka berbeda pada saat yang sama — dan dari luar tidak ada
// cara membedakan mana yang benar. Satu fetch, satu keadaan.

import { createContext, useContext, type ReactNode } from "react";
import { getDomainHealth, type DomainHealth } from "./api";
import { useAsync, type AsyncState } from "./useAsync";

type Nilai = AsyncState<DomainHealth> & { reload: () => void };

const Konteks = createContext<Nilai | null>(null);

export function DomainHealthProvider({ children }: { children: ReactNode }) {
  const state = useAsync(() => getDomainHealth(), []);
  return <Konteks.Provider value={state}>{children}</Konteks.Provider>;
}

export function useDomainHealth(): Nilai {
  const nilai = useContext(Konteks);
  if (!nilai) {
    throw new Error("useDomainHealth harus dipakai di dalam <DomainHealthProvider>");
  }
  return nilai;
}

/**
 * Apakah metrik reputasi sudah dapat diukur.
 *
 * Dipakai UI untuk memilih antara menampilkan angka dan menampilkan "belum ada
 * data". Menampilkan 0% saat belum ada pengiriman akan terbaca sebagai sangat
 * sehat, padahal tidak ada yang diukur.
 */
export function reputasiTerukur(data: DomainHealth | null): boolean {
  return data?.sumber.reputasi === "tersedia";
}
