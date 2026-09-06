// Satu putaran sinkronisasi untuk satu koneksi.
//
// Menyatukan tiga hal yang sudah ada masing-masing: pembaca kotak masuk
// (`klien.ts`), penilai korespondensi (`analisis.ts`), dan pencatat balasan
// yang sudah dipakai jalur webhook SES (`campaign/repo.ts`). Yang baru di sini
// hanya penyisipan kontak.
//
// Idempoten dengan sengaja. Putaran berikutnya membaca ulang sebagian pesan
// yang sama — `after:` di Gmail hanya berketelitian hari, jadi tumpang tindih
// tidak terhindarkan — dan itu tidak boleh menghasilkan kontak ganda maupun
// balasan yang terhitung dua kali. Keduanya dijaga di tingkat SQL:
// `ON CONFLICT DO NOTHING` untuk kontak, dan `COALESCE(replied_at, now())`
// untuk balasan.

import { query } from "../db.js";
import { catatBalasan } from "../campaign/repo.js";
import { analisis, type KandidatKontak } from "./analisis.js";
import type { KlienGmail } from "./klien.js";

/** Batas pesan per putaran. Menahan kuota Gmail API dan waktu satu putaran. */
export const BATAS_PESAN = 200;

export interface HasilSinkron {
  dibaca: number;
  balasan: number;
  kontakBaru: number;
  ditolak: Record<string, number>;
  sampai: Date;
}

/**
 * Menyisipkan kandidat sebagai kontak.
 *
 * Tiga penjagaan, dan ketiganya ada di dalam SQL yang sama dengan
 * penyisipannya — bukan sebagai langkah terpisah yang bisa terlewat:
 *
 *   1. Alamat yang sudah ada di daftar penekanan TIDAK pernah masuk kembali.
 *      Daftar itu permanen (04-aturan-kepatuhan.md §2), dan mengimpor ulang
 *      alamat yang pernah berhenti berlangganan adalah cara paling langsung
 *      melanggarnya tanpa ada yang menyadari.
 *   2. Kontak yang sudah ada dibiarkan apa adanya. Sumber izin yang lebih dulu
 *      tercatat adalah yang paling dekat dengan kejadiannya.
 *   3. `tenant_id` tidak disebut — terisi dari konteks koneksi.
 *
 * `status = 'aktif'` dan bukan `karantina`, berbeda dari impor berkas. Alasan
 * karantina adalah alamat yang belum tentu ada; alamat di sini justru yang
 * paling terbukti ada di seluruh sistem — kita pernah berkirim surat dengannya
 * dan surat itu sampai. Aktivasinya tetap dicatat atas nama orang yang
 * menyambungkan kotak masuk, lewat kolom yang sama dengan aktivasi manual.
 */
async function sisipkanKontak(kandidat: KandidatKontak[], oleh: string): Promise<number> {
  if (kandidat.length === 0) return 0;

  const { rowCount } = await query(
    `INSERT INTO contacts
       (email, domain, company_name, consent_source, consent_strength,
        consent_date, email_origin, status, activated_at, activated_by)
     SELECT k.email, split_part(k.email, '@', 2), nullif(k.nama, ''),
            'korespondensi_dua_arah', 'kuat',
            k.terakhir::date, 'found', 'aktif', now(), $2
       FROM unnest($1::jsonb[]) AS baris(j)
       CROSS JOIN LATERAL (
         SELECT (baris.j ->> 'email')::citext AS email,
                baris.j ->> 'nama' AS nama,
                to_timestamp((baris.j ->> 'terakhir')::bigint / 1000.0) AS terakhir
       ) k
      WHERE NOT EXISTS (SELECT 1 FROM suppression s WHERE s.email = k.email)
     ON CONFLICT (tenant_id, email) DO NOTHING`,
    [kandidat.map((k) => JSON.stringify(k)), oleh],
  );

  return rowCount ?? 0;
}

export async function sinkronkan(
  koneksi: { id: string; email: string; sinkron_sampai: string | null; terhubung_oleh: string },
  klien: KlienGmail,
): Promise<HasilSinkron> {
  const sejak = koneksi.sinkron_sampai ? new Date(koneksi.sinkron_sampai) : null;
  const pesan = await klien.ambilPesan(sejak, BATAS_PESAN);

  const hasil = analisis(pesan, {
    alamatSendiri: koneksi.email,
    domainInternal: [],
  });

  let balasan = 0;
  for (const b of hasil.balasan) {
    // Dicatat lewat jalur yang sama dengan webhook SES. `catatBalasan`
    // mencocokkan `Message-ID` lebih dulu, lalu jatuh ke alamat pengirim —
    // dan mengabaikan alamat yang tidak pernah dikirimi kampanye apa pun,
    // sehingga balasan dari percakapan biasa tidak menjadi "balasan kampanye".
    const tertaut = await catatBalasan({
      messageId: b.inReplyTo,
      email: b.email,
      cuplikan: b.subjek,
    });
    // Hanya yang BARU dihitung. Putaran berikutnya membaca ulang sebagian
    // pesan yang sama, dan penghitung yang ikut naik di situ akan melaporkan
    // balasan yang tidak pernah terjadi.
    if (tertaut?.baru) balasan += 1;
  }

  const kontakBaru = await sisipkanKontak(hasil.kontak, koneksi.terhubung_oleh);

  // Batas waktu diambil dari pesan terbaru yang benar-benar dibaca, bukan dari
  // jam sekarang. Kalau satu putaran berhenti di `BATAS_PESAN`, memakai jam
  // sekarang akan melewati pesan yang belum sempat terbaca — dan pesan itu
  // tidak akan pernah dilihat lagi.
  const terbaru = pesan.reduce((maks, p) => Math.max(maks, p.waktu), 0);
  const sampai = terbaru > 0 ? new Date(terbaru) : (sejak ?? new Date());

  return {
    dibaca: pesan.length,
    balasan,
    kontakBaru,
    ditolak: hasil.ditolak,
    sampai,
  };
}
