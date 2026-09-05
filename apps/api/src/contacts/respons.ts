// Penulisan hasil penilaian respons ke `contacts`.
//
// Fakta dikumpulkan di SQL, keputusannya diambil `klasifikasi` di JavaScript,
// lalu hasilnya ditulis balik. Menuliskan aturannya sebagai CASE dalam SQL
// akan lebih singkat satu putaran — tapi aturan itu lalu hidup di dua tempat,
// dan yang diuji `engagement.test.ts` bukan yang benar-benar dijalankan.
// Perbedaan semacam itu tidak menimbulkan galat, hanya kontak yang salah
// digolongkan.

import { query } from "../db.js";
import { klasifikasi, type Respons } from "../campaign/engagement.js";

/** Banyak kontak yang dinilai ulang sekali jalan. */
export const BATCH_NILAI = 2000;

interface BarisFakta {
  id: string;
  terakhir_dikirim: Date | null;
  terakhir_bereaksi: Date | null;
  menolak: boolean;
  respons: Respons;
}

export interface HasilPenilaian {
  diperiksa: number;
  berubah: number;
  /** Rincian keadaan baru, hanya untuk baris yang berubah. */
  menjadi: Partial<Record<Respons, number>>;
}

/**
 * Menilai ulang sekumpulan kontak yang penilaiannya paling basi.
 *
 * Dibatasi per putaran, bukan menyapu seluruh tabel: pekerjaan ini berjalan
 * tiap jam berdampingan dengan pengiriman, dan satu query yang mengunci
 * seluruh `contacts` akan menahan worker kirim di jam yang sama.
 *
 * Urutan `respons_dinilai_pada NULLS FIRST` membuat kontak yang belum pernah
 * dinilai selalu didahulukan, sehingga tidak ada kontak yang tertinggal
 * selamanya karena selalu kalah baru dari yang lain.
 */
export async function nilaiUlangRespons(
  batas = BATCH_NILAI,
  sekarang: Date = new Date(),
): Promise<HasilPenilaian> {
  const { rows } = await query<BarisFakta>(
    `SELECT c.id,
            c.respons::text AS respons,
            max(r.sent_at) AS terakhir_dikirim,
            -- GREATEST mengabaikan NULL di Postgres, jadi kontak yang hanya
            -- membuka (tanpa klik maupun balasan) tetap terhitung bereaksi.
            max(GREATEST(r.opened_at, r.clicked_at, r.replied_at)) AS terakhir_bereaksi,
            (c.status = 'diblokir' OR s.email IS NOT NULL) AS menolak
       FROM contacts c
       LEFT JOIN campaign_recipients r ON r.contact_id = c.id
       LEFT JOIN suppression s ON s.email = c.email
      GROUP BY c.id, c.respons, c.status, s.email, c.respons_dinilai_pada
      ORDER BY c.respons_dinilai_pada ASC NULLS FIRST
      LIMIT $1`,
    [batas],
  );

  if (rows.length === 0) return { diperiksa: 0, berubah: 0, menjadi: {} };

  const ids: string[] = [];
  const nilai: string[] = [];
  const dikirim: (Date | null)[] = [];
  const bereaksi: (Date | null)[] = [];
  const menjadi: Partial<Record<Respons, number>> = {};

  for (const baris of rows) {
    const hasil = klasifikasi(
      {
        terakhirDikirim: baris.terakhir_dikirim,
        terakhirBereaksi: baris.terakhir_bereaksi,
        menolak: baris.menolak,
      },
      sekarang,
    );

    ids.push(baris.id);
    nilai.push(hasil);
    dikirim.push(baris.terakhir_dikirim);
    bereaksi.push(baris.terakhir_bereaksi);

    if (hasil !== baris.respons) menjadi[hasil] = (menjadi[hasil] ?? 0) + 1;
  }

  // Seluruh baris ditulis ulang, termasuk yang nilainya tidak berubah:
  // `respons_dinilai_pada` harus tetap maju supaya putaran berikutnya
  // mengambil kontak yang lain. Tanpa itu, batch yang sama dinilai terus
  // dan sisa tabel tidak pernah tersentuh.
  const { rows: hasilTulis } = await query<{ berubah: string }>(
    `WITH baru AS (
       SELECT * FROM unnest(
         $1::uuid[], $2::respons_kontak[], $3::timestamptz[], $4::timestamptz[]
       ) AS t(id, respons, last_sent_at, last_engaged_at)
     ), tulis AS (
       UPDATE contacts c
          SET respons              = baru.respons,
              last_sent_at         = baru.last_sent_at,
              last_engaged_at      = baru.last_engaged_at,
              respons_dinilai_pada = now()
         FROM baru
        WHERE c.id = baru.id
       RETURNING c.id, (c.respons IS DISTINCT FROM baru.respons) AS berubah
     )
     SELECT count(*) FILTER (WHERE berubah)::text AS berubah FROM tulis`,
    [ids, nilai, dikirim, bereaksi],
  );

  return {
    diperiksa: rows.length,
    // Dihitung ulang dari yang benar-benar tertulis, bukan dari perbandingan
    // di memori: baris bisa saja sudah berubah di antara SELECT dan UPDATE.
    berubah: Number(hasilTulis[0]?.berubah ?? 0),
    menjadi,
  };
}

/** Ringkasan untuk dasbor tindak lanjut. */
export async function ringkasanRespons(): Promise<Record<Respons, number>> {
  const { rows } = await query<{ respons: Respons; jumlah: string }>(
    "SELECT respons::text AS respons, count(*)::text AS jumlah FROM contacts GROUP BY respons",
  );
  const kosong: Record<Respons, number> = {
    belum_ada: 0, menunggu: 0, tertarik: 0, menolak: 0, diam: 0,
  };
  for (const r of rows) kosong[r.respons] = Number(r.jumlah);
  return kosong;
}

export interface KontakDiam {
  id: string;
  email: string;
  company_name: string | null;
  last_sent_at: string | null;
  hari_diam: number;
}

/**
 * Kontak yang sudah melewati jendela penilaian tanpa reaksi.
 *
 * Tidak dihapus otomatis. Penghapusan permanen atas dasar "tidak membuka
 * email" adalah keputusan yang harus diambil orang, dan `retention-sweep`
 * hanya menyiapkan daftarnya — lihat catatan di `jobs/respons-worker.ts`.
 */
export async function daftarKontakDiam(page = 1, perPage = 50) {
  const limit = Math.min(Math.max(perPage, 1), 200);
  const offset = (Math.max(page, 1) - 1) * limit;

  const [items, total] = await Promise.all([
    query<KontakDiam>(
      `SELECT id, email::text AS email, company_name, last_sent_at,
              floor(extract(epoch FROM now() - last_sent_at) / 86400)::int AS hari_diam
         FROM contacts
        WHERE respons = 'diam'
        ORDER BY last_sent_at ASC NULLS LAST
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    query<{ count: string }>(
      "SELECT count(*)::text AS count FROM contacts WHERE respons = 'diam'",
    ),
  ]);

  return {
    items: items.rows,
    total: Number(total.rows[0].count),
    page: Math.max(page, 1),
    per_page: limit,
  };
}

export const MAKS_HAPUS_SEKALI = 1000;

/**
 * Menghapus kontak yang dinyatakan diam.
 *
 * Dua penjagaan yang membuat ini aman dilakukan lewat antarmuka:
 *
 *  1. Hanya `respons = 'diam'` yang terhapus. Id apa pun yang dikirim UI di
 *     luar itu diabaikan, jadi salah pilih di layar tidak dapat menghapus
 *     kontak yang baru saja membalas.
 *  2. Barisnya di `campaign_recipients` tetap ada — `contact_id` di-NULL-kan,
 *     `email` sudah tersalin. Angka pemantulan dan keluhan yang menentukan
 *     reputasi domain karena itu tidak ikut berubah saat kontak dibersihkan,
 *     dan tautan berhenti berlangganan di email yang sudah terkirim tetap
 *     dapat dipenuhi.
 *
 * Alamat yang ada di daftar penekanan tidak disentuh: daftar itu dikunci pada
 * email justru supaya bertahan lebih lama daripada kontaknya.
 */
export async function hapusKontakDiam(
  ids: string[],
  oleh: string,
): Promise<{ dihapus: number; dilewati: number }> {
  const bersih = [...new Set(ids)].slice(0, MAKS_HAPUS_SEKALI);
  if (bersih.length === 0) return { dihapus: 0, dilewati: 0 };

  const { rowCount } = await query(
    `DELETE FROM contacts WHERE id = ANY($1::uuid[]) AND respons = 'diam'`,
    [bersih],
  );

  const dihapus = rowCount ?? 0;
  console.info(`[retensi] ${dihapus} kontak diam dihapus atas nama ${oleh}`);
  return { dihapus, dilewati: bersih.length - dihapus };
}
