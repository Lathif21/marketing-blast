// Pilihan mode terang/gelap.
//
// Tiga keadaan, bukan dua: `sistem` mengikuti setelan perangkat, dan itu yang
// menjadi bawaan. Pengguna yang perangkatnya sudah disetel gelap tidak perlu
// menyetelnya lagi di sini, dan yang berpindah dari siang ke malam ikut
// berpindah tanpa menyentuh apa pun.
//
// Penyimpanannya di `localStorage`, per peramban. Sengaja TIDAK disimpan di
// basis data bersama pengguna: satu orang bisa memakai laptop terang di kantor
// dan ponsel gelap di malam hari, dan menyeragamkannya lewat akun justru
// memaksakan pilihan yang salah di salah satu perangkat.
//
// Kunci dan bentuk kelasnya (`.dark` pada elemen <html>) sengaja sama dengan
// yang dipakai skrip kecil di index.html. Skrip itu berjalan SEBELUM React
// termuat; kalau keduanya tidak sepakat, yang terlihat adalah kedipan mode
// yang salah pada setiap pemuatan halaman.

import { useEffect, useState } from "react";

export type Tema = "terang" | "gelap" | "sistem";

export const KUNCI_TEMA = "mb-tema";

const TEMA_SAH: Tema[] = ["terang", "gelap", "sistem"];

function bacaTersimpan(): Tema {
  try {
    const nilai = localStorage.getItem(KUNCI_TEMA);
    return TEMA_SAH.includes(nilai as Tema) ? (nilai as Tema) : "sistem";
  } catch {
    // Mode penyamaran atau penyimpanan yang diblokir. Bukan alasan untuk
    // gagal — cukup kembali ke bawaan.
    return "sistem";
  }
}

function sistemGelap(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/** Menghitung mode yang benar-benar berlaku, lalu memasangnya pada <html>. */
export function terapkan(tema: Tema): void {
  const gelap = tema === "gelap" || (tema === "sistem" && sistemGelap());
  document.documentElement.classList.toggle("dark", gelap);
}

/**
 * Satu-satunya cara layar mengubah tema.
 *
 * Perubahannya disiarkan lewat kejadian `storage` bawaan peramban DAN kejadian
 * buatan di bawah: `storage` hanya menyala di tab LAIN, sementara tombol yang
 * ditekan ada di tab ini. Tanpa kejadian buatan, tombol pengalih di kepala
 * halaman berubah tampilannya sendiri tapi tombol serupa di layar lain tidak.
 */
const KEJADIAN = "mb:tema-berubah";

export function setelTema(tema: Tema): void {
  try {
    localStorage.setItem(KUNCI_TEMA, tema);
  } catch {
    // Tetap terapkan meski tidak dapat disimpan: pilihannya berlaku untuk
    // sesi ini, dan itu lebih baik daripada tombol yang tidak melakukan apa-apa.
  }
  terapkan(tema);
  window.dispatchEvent(new Event(KEJADIAN));
}

export function useTema(): { tema: Tema; setel: (t: Tema) => void; gelap: boolean } {
  const [tema, setTema] = useState<Tema>(bacaTersimpan);

  useEffect(() => {
    const segarkan = () => setTema(bacaTersimpan());
    window.addEventListener(KEJADIAN, segarkan);
    window.addEventListener("storage", segarkan);

    // Saat pilihannya `sistem`, setelan perangkat bisa berubah di tengah
    // pemakaian — malam tiba, atau pengguna mengubahnya di setelan sistem.
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const ikutiSistem = () => terapkan(bacaTersimpan());
    media?.addEventListener("change", ikutiSistem);

    return () => {
      window.removeEventListener(KEJADIAN, segarkan);
      window.removeEventListener("storage", segarkan);
      media?.removeEventListener("change", ikutiSistem);
    };
  }, []);

  return {
    tema,
    setel: setelTema,
    gelap: tema === "gelap" || (tema === "sistem" && sistemGelap()),
  };
}
