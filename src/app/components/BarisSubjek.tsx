// Baris subjek — Revisi 5 di 05-revisi-desain.md.
//
// Dalam email marketing, baris subjek adalah satu hal yang paling menentukan
// berhasil-tidaknya kampanye. Di prototype ia diperlakukan sebagai field form
// biasa: satu baris 12px di antara belasan field lain yang semuanya seukuran.
//
// Di sini ia menjadi elemen terbesar pada langkah penyusunan pesan, dengan dua
// hal yang tidak dimiliki field biasa:
//
//   1. hitungan karakter beserta AMBANGNYA — bukan sekadar angka, tapi
//      penilaian: aman, mulai panjang, atau akan terpotong
//   2. pratinjau bagaimana baris itu benar-benar tampil di kotak masuk,
//      lengkap dengan pemenggalannya
//
// Yang kedua itu yang membuatnya berguna, bukan sekadar besar. Penulis subjek
// menebak-nebak bagaimana tampilannya di ponsel penerima; menampilkannya
// menghapus tebakan itu. Ini artefak paling khas dunia email marketing, dan
// alasan produk ini terbaca sebagai alat pemasar — bukan panel instrumentasi.

import { Mono, Num, PanelLabel } from "./Typography";

/**
 * Ambang panjang subjek.
 *
 * Bukan aturan mutlak — tidak ada standar yang menetapkannya — melainkan
 * batas praktis: kebanyakan klien surel di ponsel memotong di sekitar 40-an
 * karakter, dan di desktop sekitar 60. Karena itu keduanya ditandai, dan
 * keduanya disebut sebagai "terpotong di ...", bukan sebagai benar/salah.
 */
const BATAS_PONSEL = 42;
const BATAS_DESKTOP = 60;

interface Props {
  nilai: string;
  onUbah: (v: string) => void;
  /** Subjek dengan penanda yang sudah terisi contoh nyata. */
  pratinjau: string;
  /** Nama pengirim seperti yang dilihat penerima. */
  namaPengirim: string;
  /** Baris pertama isi pesan, untuk cuplikan di bawah subjek. */
  cuplikan: string;
}

export function BarisSubjek({ nilai, onUbah, pratinjau, namaPengirim, cuplikan }: Props) {
  const panjang = nilai.length;
  const lewatDesktop = panjang > BATAS_DESKTOP;
  const lewatPonsel = panjang > BATAS_PONSEL;

  const warna = lewatDesktop
    ? "var(--bahaya)"
    : lewatPonsel
      ? "var(--peringatan)"
      : "var(--sukses)";

  const catatan = lewatDesktop
    ? "akan terpotong di kebanyakan klien surel"
    : lewatPonsel
      ? "terpotong di ponsel, utuh di desktop"
      : "utuh di ponsel maupun desktop";

  // Pemenggalan pratinjau memakai ambang ponsel: itu keadaan tersempit, dan
  // yang perlu dilihat penulis adalah bentuk terburuknya — bukan yang terbaik.
  const terpotong =
    pratinjau.length > BATAS_PONSEL ? `${pratinjau.slice(0, BATAS_PONSEL).trimEnd()}…` : pratinjau;

  const inisial = namaPengirim.trim().charAt(0).toUpperCase() || "?";
  const jam = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      className="rounded-sm p-4"
      style={{
        backgroundColor: "rgb(var(--primary-rgb) / 0.06)",
        border: "1px solid rgb(var(--primary-rgb) / 0.22)",
      }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <PanelLabel>Baris subjek</PanelLabel>
        <span className="text-xs flex items-baseline gap-1.5" style={{ color: warna }}>
          <Num className="font-semibold">
            {panjang}/{BATAS_DESKTOP}
          </Num>
          <span className="text-muted-foreground">{catatan}</span>
        </span>
      </div>

      {/*
        Ukuran teksnya sengaja jauh lebih besar daripada field lain di layar
        ini. Bukan penekanan visual belaka: penulis membaca ulang subjeknya
        puluhan kali, dan 13px di antara belasan field seukuran membuatnya
        terbaca sebagai isian administratif — bukan sebagai kalimat yang
        menentukan apakah pesan ini dibuka.
      */}
      <input
        type="text"
        value={nilai}
        onChange={(e) => onUbah(e.target.value)}
        placeholder="Tulis baris subjek…"
        className="w-full bg-transparent border-0 border-b-2 px-0 pb-2 text-xl text-foreground outline-none"
        style={{ borderColor: warna, caretColor: "var(--primary)" }}
      />

      <div className="mt-4">
        <PanelLabel className="mb-1.5">Tampil di kotak masuk</PanelLabel>
        <div
          className="rounded-sm px-3 py-2.5 flex gap-2.5"
          style={{
            backgroundColor: "var(--card)",
            border: "1px solid rgb(var(--kabut-rgb) / 0.16)",
          }}
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold"
            style={{
              backgroundColor: "rgb(var(--primary-rgb) / 0.18)",
              color: "var(--primary)",
            }}
          >
            {inisial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-foreground truncate">
                {namaPengirim}
              </span>
              <Num className="text-label text-muted-foreground flex-shrink-0">{jam}</Num>
            </div>
            <div className="text-xs text-foreground truncate">
              {terpotong || <span className="text-muted-foreground">(subjek kosong)</span>}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {cuplikan || "…"}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
          Penanda seperti <Mono>{"{{nama_perusahaan}}"}</Mono> sudah terisi dengan penerima
          pertama yang Anda pilih, jadi yang tampil di atas adalah yang benar-benar dikirim.
        </p>
      </div>
    </div>
  );
}
