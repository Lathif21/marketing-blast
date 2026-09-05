// Penilaian respons kontak atas kampanye perkenalan.
//
// Kampanye pertama hanya mengajak berkenalan. Yang menentukan langkah
// berikutnya adalah reaksi penerima, dan reaksi itu perlu diterjemahkan
// menjadi satu keadaan yang dapat dipakai menyusun segmen.
//
// Aturannya dipisah menjadi fungsi murni `klasifikasi` supaya dapat diuji
// tanpa basis data. Ini aturan yang menentukan siapa yang masih dikirimi dan
// siapa yang berhenti dikirimi — salah di sini tidak memunculkan galat, hanya
// email yang sampai ke orang yang sudah tidak ingin menerimanya.
//
// Yang TIDAK dapat dideteksi, dan sengaja tidak dipura-purakan:
//
//   * email dihapus tanpa dibuka — tidak ada sinyalnya, tidak ada standar yang
//     melaporkannya. Diperlakukan sama dengan tidak dibuka.
//   * email dibuka tapi gambar diblokir — pelacak buka tidak berjalan, jadi
//     terbaca sebagai tidak dibuka.
//
// Keduanya bermuara pada `diam`, bukan `menolak`. Perbedaannya penting:
// `menolak` adalah penolakan yang dinyatakan penerima dan berujung ke daftar
// penekanan; `diam` hanya berarti tidak ada jawaban, dan kontaknya masih boleh
// dihubungi lewat kanal lain oleh manusia.

/** Jendela penilaian. Setelah ini tanpa reaksi, kontak dinyatakan `diam`. */
export const JENDELA_DIAM_HARI = 30;

export type Respons = "belum_ada" | "menunggu" | "tertarik" | "menolak" | "diam";

export interface FaktaKontak {
  /** Waktu pesan terakhir yang benar-benar keluar. `null` bila belum pernah. */
  terakhirDikirim: Date | null;
  /** Waktu reaksi terakhir: buka, klik, atau balasan. */
  terakhirBereaksi: Date | null;
  /** Keluhan spam, berhenti berlangganan, atau alamat sudah tertekan. */
  menolak: boolean;
}

/**
 * Urutannya menentukan hasil, jadi disusun dari yang paling mengikat:
 *
 *  1. `menolak` mengalahkan segalanya. Seseorang bisa membuka email lalu
 *     menandainya spam — yang berlaku adalah yang terakhir dinyatakan, dan
 *     mengirimi kampanye lanjutan kepadanya karena "toh pernah membuka"
 *     adalah cara tercepat mengubah satu keluhan menjadi beberapa.
 *  2. `tertarik` — ada reaksi, apa pun umurnya. Reaksi tidak kedaluwarsa
 *     menjadi `diam`; kalau tindak lanjutnya terlambat, itu masalah jadwal
 *     kampanye, bukan alasan menghapus fakta bahwa orangnya pernah menjawab.
 *  3. `belum_ada` — belum pernah dikirimi, jadi belum ada yang bisa dinilai.
 *  4. `diam` vs `menunggu` — ditentukan usia pengiriman terakhir.
 */
export function klasifikasi(fakta: FaktaKontak, sekarang: Date = new Date()): Respons {
  if (fakta.menolak) return "menolak";
  if (fakta.terakhirBereaksi) return "tertarik";
  if (!fakta.terakhirDikirim) return "belum_ada";

  const umurHari =
    (sekarang.getTime() - fakta.terakhirDikirim.getTime()) / (24 * 60 * 60 * 1000);

  return umurHari >= JENDELA_DIAM_HARI ? "diam" : "menunggu";
}

/** Label siap tampil. Dipakai UI dan ringkasan API supaya tidak berbeda. */
export const LABEL_RESPONS: Record<Respons, string> = {
  belum_ada: "Belum dikirimi",
  menunggu: "Menunggu reaksi",
  tertarik: "Tertarik",
  menolak: "Menolak",
  diam: `Tanpa respons ${JENDELA_DIAM_HARI} hari`,
};

export const SEMUA_RESPONS: Respons[] = [
  "belum_ada",
  "menunggu",
  "tertarik",
  "menolak",
  "diam",
];
