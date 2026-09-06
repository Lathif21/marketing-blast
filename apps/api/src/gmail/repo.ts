// Akses tabel `gmail_connections`.
//
// Tabel ini bertenant dan dilindungi Row Level Security seperti data pelanggan
// lain, jadi query di sini tidak menyebut `tenant_id` sama sekali — kolomnya
// terisi dari konteks koneksi (migrasi 010).

import { query } from "../db.js";
import { dekripsi, enkripsi } from "../lib/rahasia.js";

export type StatusGmail = "aktif" | "perlu_sambung_ulang" | "dicabut";

export interface Koneksi {
  id: string;
  email: string;
  google_sub: string;
  scopes: string;
  status: StatusGmail;
  terhubung_oleh: string;
  terhubung_pada: string;
  sinkron_sampai: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  balasan_tercatat: number;
  kontak_ditambahkan: number;
}

const KOLOM = `id, email::text AS email, google_sub, scopes, status::text AS status,
               terhubung_oleh, terhubung_pada, sinkron_sampai, last_sync_at,
               last_error, balasan_tercatat, kontak_ditambahkan`;

export async function daftar(): Promise<Koneksi[]> {
  const { rows } = await query<Koneksi>(
    `SELECT ${KOLOM} FROM gmail_connections ORDER BY terhubung_pada`,
  );
  return rows;
}

export async function ambil(id: string): Promise<Koneksi | null> {
  const { rows } = await query<Koneksi>(
    `SELECT ${KOLOM} FROM gmail_connections WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Menyimpan koneksi baru, atau menghidupkan kembali yang sudah ada untuk
 * alamat yang sama.
 *
 * Menyambungkan ulang alamat yang sudah pernah terhubung adalah jalur yang
 * PALING SERING dipakai, bukan kasus tepi: selama aplikasi berstatus "Testing"
 * di Google Cloud, token penyegar kedaluwarsa tiap tujuh hari dan satu-satunya
 * pemulihannya adalah alur ini. Karena itu `sinkron_sampai` sengaja
 * dipertahankan — menyambung ulang tidak boleh berarti membaca ulang seluruh
 * kotak masuk dari awal.
 */
export async function simpan(input: {
  email: string;
  googleSub: string;
  refreshToken: string;
  scopes: string;
  oleh: string;
}): Promise<Koneksi> {
  const { rows } = await query<Koneksi>(
    `INSERT INTO gmail_connections (email, google_sub, refresh_token, scopes, terhubung_oleh)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, email) DO UPDATE
        SET refresh_token = EXCLUDED.refresh_token,
            google_sub    = EXCLUDED.google_sub,
            scopes        = EXCLUDED.scopes,
            terhubung_oleh = EXCLUDED.terhubung_oleh,
            terhubung_pada = now(),
            status        = 'aktif',
            last_error    = NULL
     RETURNING ${KOLOM}`,
    [input.email, input.googleSub, enkripsi(input.refreshToken), input.scopes, input.oleh],
  );
  return rows[0];
}

/** `null` bila koneksinya sudah tidak dapat dipakai atau tidak dapat didekripsi. */
export async function tokenPenyegar(id: string): Promise<string | null> {
  const { rows } = await query<{ refresh_token: string | null }>(
    "SELECT refresh_token FROM gmail_connections WHERE id = $1 AND status = 'aktif'",
    [id],
  );
  const tersimpan = rows[0]?.refresh_token;
  return tersimpan ? dekripsi(tersimpan) : null;
}

/** Koneksi yang masih boleh disinkronkan. Dipakai pekerjaan latar. */
export async function koneksiAktif(): Promise<Koneksi[]> {
  const { rows } = await query<Koneksi>(
    `SELECT ${KOLOM} FROM gmail_connections WHERE status = 'aktif' ORDER BY last_sync_at ASC NULLS FIRST`,
  );
  return rows;
}

export async function catatSinkron(
  id: string,
  hasil: { sampai: Date; balasan: number; kontak: number },
): Promise<void> {
  await query(
    `UPDATE gmail_connections
        SET sinkron_sampai = $2,
            last_sync_at = now(),
            last_error = NULL,
            balasan_tercatat = balasan_tercatat + $3,
            kontak_ditambahkan = kontak_ditambahkan + $4
      WHERE id = $1`,
    [id, hasil.sampai, hasil.balasan, hasil.kontak],
  );
}

/**
 * Menandai koneksi bermasalah.
 *
 * `perluSambungUlang` membedakan "izinnya habis" dari "ada galat sesaat".
 * Bedanya menentukan yang ditampilkan ke pengguna: yang pertama menuntut
 * tindakan mereka, yang kedua akan pulih sendiri pada putaran berikutnya —
 * dan meminta orang menyambungkan ulang untuk galat jaringan sesaat adalah
 * cara cepat membuat mereka berhenti memercayai pesan itu.
 */
export async function catatGalat(
  id: string,
  pesan: string,
  perluSambungUlang: boolean,
): Promise<void> {
  await query(
    `UPDATE gmail_connections
        SET last_error = $2,
            last_sync_at = now(),
            status = CASE WHEN $3 THEN 'perlu_sambung_ulang'::status_gmail ELSE status END,
            refresh_token = CASE WHEN $3 THEN NULL ELSE refresh_token END
      WHERE id = $1`,
    [id, pesan.slice(0, 500), perluSambungUlang],
  );
}

/**
 * Memutus koneksi.
 *
 * Barisnya tidak dihapus, hanya tokennya dibuang dan statusnya diubah. Siapa
 * yang pernah menyambungkan kotak masuk apa, dan kapan, adalah jejak yang
 * tetap perlu ada setelah koneksinya berakhir — terutama karena yang
 * disambungkan adalah kotak masuk berisi surat pihak ketiga.
 */
export async function putus(id: string): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE gmail_connections
        SET status = 'dicabut', refresh_token = NULL, last_error = NULL
      WHERE id = $1`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}
