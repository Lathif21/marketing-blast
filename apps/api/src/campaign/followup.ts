// Kampanye tindak lanjut.
//
// Alurnya: kampanye perkenalan terkirim, sebagian penerima bereaksi, dan yang
// bereaksi menerima langkah berikutnya secara otomatis. Tanpa ini, satu-satunya
// cara menindaklanjuti adalah membalas satu per satu — pekerjaan yang tumbuh
// sebanding dengan keberhasilan kampanye, jadi justru menjadi hambatan tepat
// saat kampanyenya berhasil.
//
// Yang TIDAK dilakukan modul ini, dan sebaiknya tetap begitu: membalas isi
// balasan penerima. Balasan yang dijawab mesin dengan kalimat yang tidak
// menyinggung isinya lebih merusak daripada balasan yang terlambat dijawab
// manusia. Yang dikirim adalah pesan langkah-berikutnya yang sudah disiapkan
// dan disetujui sebelumnya, lewat jalur kampanye yang sama — lengkap dengan
// preflight, batas pemanasan, dan tautan berhenti berlangganan.

export type Pemicu = "membalas" | "diklik" | "dibuka" | "apa_saja";

export const PEMICU: Pemicu[] = ["membalas", "diklik", "dibuka", "apa_saja"];

export const LABEL_PEMICU: Record<Pemicu, string> = {
  membalas: "Membalas email",
  diklik: "Mengklik tautan",
  dibuka: "Membuka email",
  apa_saja: "Bereaksi dengan cara apa pun",
};

/** Jeda bawaan sebelum tindak lanjut dikirim. */
export const JEDA_BAWAAN_JAM = 24;

export interface IntiLanjutan {
  parent_campaign_id: string | null;
  pemicu: Pemicu | null;
  jeda_lanjutan_jam: number;
  segment_filter: Record<string, unknown>;
}

/**
 * Segmen efektif sebuah kampanye.
 *
 * SATU sumber untuk tiga pemakai: penyusunan antrean, pemeriksaan pra-kirim,
 * dan pendaftaran bergulir worker tindak lanjut. Ketiganya harus melihat
 * himpunan penerima yang sama — kalau pra-kirim menghitung dari
 * `segment_filter` mentah sementara antrean menambahkan kriteria tindak
 * lanjut, angka yang dipakai memutuskan boleh-tidaknya mengirim bukan angka
 * yang benar-benar dikirimi. Kekeliruan yang persis sama sudah pernah terjadi
 * di `segment.ts`; ini alasan kriteria tindak lanjut tidak ditaruh langsung di
 * pemanggilnya.
 */
export function filterEfektif(c: IntiLanjutan): Record<string, unknown> {
  const dasar = c.segment_filter ?? {};
  if (!c.parent_campaign_id || !c.pemicu) return dasar;

  return {
    ...dasar,
    respons_kampanye: {
      campaign_id: c.parent_campaign_id,
      pemicu: c.pemicu,
      jeda_jam: c.jeda_lanjutan_jam,
    },
  };
}

export function pemicuSah(nilai: unknown): nilai is Pemicu {
  return typeof nilai === "string" && (PEMICU as string[]).includes(nilai);
}
