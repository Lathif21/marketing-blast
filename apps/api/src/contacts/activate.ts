// Aktivasi manual kontak karantina.
//
// Tiga aturan ditegakkan DI SINI, bukan di UI. Antarmuka bisa dilewati —
// endpoint tidak, dan endpoint inilah yang menulis ke basis data.
//
//   1. Hanya `karantina` yang dapat menjadi `aktif`.
//      `diblokir` TIDAK PERNAH boleh dibangkitkan. Kontak berstatus diblokir
//      ada di sana karena penerimanya berhenti berlangganan, alamatnya
//      memantul keras, atau ada keluhan spam. Menghidupkannya kembali lewat
//      layar aktivasi akan membatalkan daftar penekanan yang justru dirancang
//      permanen (04-aturan-kepatuhan.md §2).
//
//   2. Alamat yang ada di daftar penekanan tidak dapat diaktifkan.
//      Pemeriksaan terpisah dari nomor 1, bukan pengulangan: kontak bisa saja
//      berstatus `karantina` sementara alamatnya sudah masuk daftar penekanan
//      lewat jalur lain — misalnya diimpor ulang setelah berhenti berlangganan.
//
//   3. Alamat hasil tebakan (`email_origin = 'guessed'`) ditolak secara bawaan.
//      Menggabungkan domain yang belum punya reputasi dengan alamat yang belum
//      tentu ada adalah kombinasi paling merusak yang dapat dilakukan sistem
//      ini (§4). Pengecualian tersedia, tapi harus diminta eksplisit dan
//      dicatat siapa yang meminta.

import { transaction } from "../db.js";

export interface PermintaanAktivasi {
  ids: string[];
  /** Nama yang bertanggung jawab atas penilaian ini. Wajib. */
  dinyatakanOleh: string;
  /**
   * Membuka aktivasi untuk alamat hasil tebakan. Bawaannya `false`, dan
   * memang harus begitu: pengecualian yang aktif tanpa diminta bukan
   * pengecualian.
   */
  izinkanTebakan?: boolean;
}

export type AlasanTolak =
  | "tidak_ditemukan"
  | "sudah_aktif"
  | "diblokir"
  | "ada_di_penekanan"
  | "alamat_tebakan";

export interface HasilAktivasi {
  diaktifkan: number;
  ditolak: { id: string; email: string | null; alasan: AlasanTolak }[];
  /** Rincian per alasan, untuk ditampilkan tanpa perlu menghitung di UI. */
  ringkasan: Record<AlasanTolak, number>;
}

const ALASAN: AlasanTolak[] = [
  "tidak_ditemukan",
  "sudah_aktif",
  "diblokir",
  "ada_di_penekanan",
  "alamat_tebakan",
];

interface BarisKandidat {
  id: string;
  email: string;
  status: "aktif" | "karantina" | "diblokir";
  email_origin: "found" | "guessed" | "manual";
  tersuppress: boolean;
}

export const MAKS_SEKALI = 1000;

export async function aktifkanKontak(req: PermintaanAktivasi): Promise<HasilAktivasi> {
  const ids = [...new Set(req.ids)].slice(0, MAKS_SEKALI);
  const ringkasan = Object.fromEntries(ALASAN.map((a) => [a, 0])) as Record<AlasanTolak, number>;
  const ditolak: HasilAktivasi["ditolak"] = [];

  if (ids.length === 0) return { diaktifkan: 0, ditolak, ringkasan };

  return transaction(async (client) => {
    // `FOR UPDATE` menahan barisnya selama penilaian, supaya keputusan tidak
    // dibuat berdasarkan status yang sudah basi saat penulisan terjadi.
    const { rows } = await client.query<BarisKandidat>(
      `SELECT c.id,
              c.email::text AS email,
              c.status::text AS status,
              c.email_origin::text AS email_origin,
              EXISTS (SELECT 1 FROM suppression s WHERE s.email = c.email) AS tersuppress
         FROM contacts c
        WHERE c.id = ANY($1::uuid[])
        FOR UPDATE OF c`,
      [ids],
    );

    const ditemukan = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      if (!ditemukan.has(id)) {
        ditolak.push({ id, email: null, alasan: "tidak_ditemukan" });
        ringkasan.tidak_ditemukan += 1;
      }
    }

    const layak: string[] = [];
    for (const baris of rows) {
      const tolak = (alasan: AlasanTolak) => {
        ditolak.push({ id: baris.id, email: baris.email, alasan });
        ringkasan[alasan] += 1;
      };

      if (baris.status === "aktif") {
        tolak("sudah_aktif");
        continue;
      }
      // Aturan 1 — tidak ada jalan kembali dari diblokir lewat jalur ini.
      if (baris.status === "diblokir") {
        tolak("diblokir");
        continue;
      }
      // Aturan 2 — diperiksa terpisah dari status.
      if (baris.tersuppress) {
        tolak("ada_di_penekanan");
        continue;
      }
      // Aturan 3 — bawaannya menolak.
      if (baris.email_origin === "guessed" && !req.izinkanTebakan) {
        tolak("alamat_tebakan");
        continue;
      }
      layak.push(baris.id);
    }

    if (layak.length === 0) return { diaktifkan: 0, ditolak, ringkasan };

    const { rowCount } = await client.query(
      `UPDATE contacts
          SET status = 'aktif',
              activated_at = now(),
              activated_by = $2
        WHERE id = ANY($1::uuid[])`,
      [layak, req.dinyatakanOleh],
    );

    return { diaktifkan: rowCount ?? 0, ditolak, ringkasan };
  });
}

/**
 * Mengembalikan kontak ke karantina. Disediakan supaya aktivasi yang keliru
 * dapat dibatalkan tanpa membuka akses SQL langsung — dan karena aksi yang
 * tidak bisa dibatalkan membuat orang ragu memakainya sama sekali.
 *
 * Tidak menyentuh `diblokir`: itu bukan hasil aktivasi, dan mengubahnya bukan
 * urusan jalur ini.
 */
export async function karantinakanKontak(ids: string[]): Promise<{ dikarantina: number }> {
  const bersih = [...new Set(ids)].slice(0, MAKS_SEKALI);
  if (bersih.length === 0) return { dikarantina: 0 };

  return transaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE contacts
          SET status = 'karantina', activated_at = NULL, activated_by = NULL
        WHERE id = ANY($1::uuid[]) AND status = 'aktif'`,
      [bersih],
    );
    return { dikarantina: rowCount ?? 0 };
  });
}
