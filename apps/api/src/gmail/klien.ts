// Pembaca kotak masuk Gmail.
//
// Bentuknya mengikuti `mail/index.ts`: satu antarmuka, satu implementasi
// sungguhan, satu tiruan. Alasannya sama juga — seluruh alur impor harus dapat
// dibuktikan bekerja tanpa menyentuh kotak masuk siapa pun, dan uji yang
// membutuhkan akun Google sungguhan adalah uji yang tidak pernah dijalankan.
//
// Yang diminta dari Gmail hanyalah HEADER, lewat `format=metadata` beserta
// daftar header yang dibutuhkan. Isi pesan tidak pernah diminta, jadi ia tidak
// pernah melewati proses ini — bukan sekadar tidak disimpan.

import type { PesanRingkas } from "./analisis.js";

export interface KlienGmail {
  nama: string;
  /**
   * Pesan yang lebih baru daripada `sejak`, terbaru lebih dulu.
   * `batas` menahan satu putaran supaya kuota harian tidak habis sekaligus.
   */
  ambilPesan(sejak: Date | null, batas: number): Promise<PesanRingkas[]>;
}

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Header yang diminta. Di luar ini tidak ada yang dibaca. */
const HEADER = [
  "From",
  "To",
  "Cc",
  "Subject",
  "Message-ID",
  "In-Reply-To",
  "References",
  "List-Unsubscribe",
  "Precedence",
  "Auto-Submitted",
];

interface PesanApi {
  id: string;
  threadId: string;
  internalDate?: string;
  payload?: { headers?: { name?: string; value?: string }[] };
}

function header(p: PesanApi, nama: string): string | null {
  const cocok = (p.payload?.headers ?? []).find(
    (h) => h.name?.toLowerCase() === nama.toLowerCase(),
  );
  return cocok?.value?.trim() || null;
}

/** `a@x.id, "B" <b@x.id>` → dua entri. Tanda kutip menjaga koma di dalam nama. */
export function pisahAlamat(raw: string | null): string[] {
  if (!raw) return [];
  const hasil: string[] = [];
  let sekarang = "";
  let dalamKutip = false;

  for (const ch of raw) {
    if (ch === '"') dalamKutip = !dalamKutip;
    if (ch === "," && !dalamKutip) {
      if (sekarang.trim()) hasil.push(sekarang.trim());
      sekarang = "";
      continue;
    }
    sekarang += ch;
  }
  if (sekarang.trim()) hasil.push(sekarang.trim());
  return hasil;
}

export function keRingkas(p: PesanApi): PesanRingkas {
  return {
    id: p.id,
    threadId: p.threadId,
    waktu: Number(p.internalDate ?? 0),
    dari: header(p, "From") ?? "",
    kepada: [...pisahAlamat(header(p, "To")), ...pisahAlamat(header(p, "Cc"))],
    subjek: header(p, "Subject"),
    inReplyTo: header(p, "In-Reply-To"),
    references: header(p, "References"),
    listUnsubscribe: header(p, "List-Unsubscribe"),
    precedence: header(p, "Precedence"),
    autoSubmitted: header(p, "Auto-Submitted"),
  };
}

export class GalatGmail extends Error {
  constructor(
    public status: number,
    pesan: string,
  ) {
    super(pesan);
    this.name = "GalatGmail";
  }

  /** 401 berarti izinnya tidak berlaku lagi; 403 sering berarti kuota habis. */
  get perluSambungUlang(): boolean {
    return this.status === 401;
  }
}

/**
 * Klien sungguhan.
 *
 * `q` dipakai untuk menyaring di sisi Google — inilah alasan scope yang
 * diminta `gmail.readonly` dan bukan `gmail.metadata` (lihat oauth.ts).
 * Menyaring di sisi kita berarti menarik seluruh kotak masuk lebih dulu, dan
 * kuota Gmail dihitung per permintaan, bukan per pesan yang berguna.
 */
export function klienGoogle(accessToken: string): KlienGmail {
  const ambil = async <T>(url: string): Promise<T> => {
    const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const badan = await res.text().catch(() => "");
      throw new GalatGmail(res.status, `Gmail API ${res.status}: ${badan.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  };

  return {
    nama: "google",

    async ambilPesan(sejak, batas) {
      // Kotak masuk DAN kotak keluar: aturan dua arah menuntut keduanya. Hanya
      // membaca kotak masuk membuat setiap alamat tampak satu arah, dan hasil
      // impornya selalu kosong.
      const bagian = ["(in:inbox OR in:sent)", "-in:chats", "-in:spam", "-in:trash"];
      if (sejak) {
        // Gmail hanya menerima ketelitian per hari pada `after:`. Sehari
        // dikurangi supaya pesan di perbatasan zona waktu tidak terlewat —
        // memproses ulang beberapa pesan tidak berbahaya (penyisipan kontak
        // dan pencatatan balasan sama-sama idempoten), sedangkan melewatkan
        // balasan berarti kehilangan sinyal ketertarikan terkuat.
        const hari = new Date(sejak.getTime() - 24 * 60 * 60 * 1000);
        bagian.push(`after:${hari.toISOString().slice(0, 10).replace(/-/g, "/")}`);
      }

      const daftar = await ambil<{ messages?: { id: string }[] }>(
        `${API}/messages?maxResults=${batas}&q=${encodeURIComponent(bagian.join(" "))}`,
      );

      const ids = (daftar.messages ?? []).map((m) => m.id);
      const hasil: PesanRingkas[] = [];

      // Berurutan, bukan paralel. Gmail membatasi laju per pengguna, dan
      // permintaan yang ditolak 429 harus diulang — yang justru lebih lambat
      // daripada berurutan sejak awal.
      for (const id of ids) {
        const p = await ambil<PesanApi>(
          `${API}/messages/${id}?format=metadata&${HEADER.map((h) => `metadataHeaders=${h}`).join("&")}`,
        );
        hasil.push(keRingkas(p));
      }

      return hasil;
    },
  };
}

/**
 * Klien tiruan. Dipakai uji regresi dan pengembangan tanpa kredensial Google.
 *
 * Ada supaya seluruh alur — koneksi, sinkronisasi, penilaian, penyisipan
 * kontak, pencatatan balasan — dapat dijalankan dan dibuktikan tanpa satu pun
 * kotak masuk sungguhan tersentuh.
 */
export function klienTiruan(pesan: PesanRingkas[]): KlienGmail {
  return {
    nama: "tiruan",
    async ambilPesan(sejak, batas) {
      const batasWaktu = sejak ? sejak.getTime() - 24 * 60 * 60 * 1000 : 0;
      return pesan.filter((p) => p.waktu >= batasWaktu).slice(0, batas);
    },
  };
}
