// Akses tabel `tenants`.
//
// Dua jenis query bercampur di berkas ini, dan bedanya penting:
//
//   queryGlobal() — tabel `tenants` sendiri, yang berada di luar RLS
//   query()       — data pelanggan (kontak, kampanye, penekanan) untuk angka
//                   ringkasan, yang HANYA terbaca dari konteks superadmin
//
// Fungsi yang memakai `query()` karena itu wajib dipanggil dari rute
// superadmin. Dipanggil dari konteks pelanggan biasa, angka yang keluar hanya
// milik pelanggan itu — bukan galat, jadi tidak akan terlihat kecuali disadari
// lebih dulu. Itu sebabnya rute-rutenya dikumpulkan di `routes/admin.ts` dan
// dijaga satu pemeriksaan peran.

import { query, queryGlobal } from "../db.js";
import { cabutSesiTenant } from "../auth/repo.js";

export type StatusTenant = "aktif" | "dibekukan" | "nonaktif";

export interface Tenant {
  id: string;
  nama: string;
  slug: string;
  status: StatusTenant;
  kuota_kontak: number | null;
  catatan: string | null;
  alasan_beku: string | null;
  dibekukan_pada: string | null;
  dibekukan_oleh: string | null;
  created_at: string;
}

const KOLOM = `id, nama, slug::text AS slug, status::text AS status, kuota_kontak,
               catatan, alasan_beku, dibekukan_pada, dibekukan_oleh, created_at`;

export const SLUG_VALID = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export async function daftar(): Promise<Tenant[]> {
  const { rows } = await queryGlobal<Tenant>(
    `SELECT ${KOLOM} FROM tenants ORDER BY created_at`,
  );
  return rows;
}

export async function ambil(id: string): Promise<Tenant | null> {
  const { rows } = await queryGlobal<Tenant>(`SELECT ${KOLOM} FROM tenants WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function ambilLewatSlug(slug: string): Promise<Tenant | null> {
  const { rows } = await queryGlobal<Tenant>(`SELECT ${KOLOM} FROM tenants WHERE slug = $1`, [
    slug,
  ]);
  return rows[0] ?? null;
}

export async function buat(input: {
  nama: string;
  slug: string;
  kuotaKontak?: number | null;
  catatan?: string | null;
}): Promise<Tenant> {
  const { rows } = await queryGlobal<Tenant>(
    `INSERT INTO tenants (nama, slug, kuota_kontak, catatan)
     VALUES ($1, $2, $3, $4)
     RETURNING ${KOLOM}`,
    [input.nama, input.slug, input.kuotaKontak ?? null, input.catatan ?? null],
  );
  return rows[0];
}

export async function ubah(
  id: string,
  patch: { nama?: string; kuotaKontak?: number | null; catatan?: string | null },
): Promise<Tenant | null> {
  const set: string[] = [];
  const params: unknown[] = [];

  if (patch.nama !== undefined) {
    params.push(patch.nama);
    set.push(`nama = $${params.length}`);
  }
  // `kuota_kontak` boleh disetel ke null (tanpa batas), jadi `undefined` dan
  // `null` harus dibedakan — bukan digabung sebagai "tidak diisi".
  if (patch.kuotaKontak !== undefined) {
    params.push(patch.kuotaKontak);
    set.push(`kuota_kontak = $${params.length}`);
  }
  if (patch.catatan !== undefined) {
    params.push(patch.catatan);
    set.push(`catatan = $${params.length}`);
  }
  if (set.length === 0) return ambil(id);

  params.push(id);
  const { rows } = await queryGlobal<Tenant>(
    `UPDATE tenants SET ${set.join(", ")}, updated_at = now()
      WHERE id = $${params.length}
      RETURNING ${KOLOM}`,
    params,
  );
  return rows[0] ?? null;
}

/**
 * Membekukan pelanggan.
 *
 * Tiga hal terjadi bersamaan, dan ketiganya perlu:
 *
 *  1. status menjadi `dibekukan` — `send-worker` melewatinya, dan pra-kirim
 *     memblokir kampanye baru
 *  2. alasannya disimpan — pelanggan yang pengirimannya berhenti akan bertanya
 *     kenapa, dan jawabannya harus ada di sistem
 *  3. seluruh sesinya dicabut — tanpa ini, pembekuan baru terasa setelah sesi
 *     yang sedang berjalan habis sendiri, dan yang dibekukan karena reputasi
 *     rusak justru masih bisa menyusun kampanye berikutnya selama jam-jam itu
 *
 * Yang TIDAK terjadi: data pelanggan tidak disembunyikan dan tidak dihapus.
 * Membekukan berbeda dari menghapus, dan pelanggan yang dibekukan tetap perlu
 * melihat keadaan akunnya untuk memperbaikinya.
 */
export async function bekukan(
  id: string,
  alasan: string,
  oleh: string,
): Promise<{ tenant: Tenant | null; sesi_dicabut: number }> {
  const { rows } = await queryGlobal<Tenant>(
    `UPDATE tenants
        SET status = 'dibekukan', alasan_beku = $2, dibekukan_pada = now(),
            dibekukan_oleh = $3, updated_at = now()
      WHERE id = $1
      RETURNING ${KOLOM}`,
    [id, alasan, oleh],
  );
  if (rows.length === 0) return { tenant: null, sesi_dicabut: 0 };

  const dicabut = await cabutSesiTenant(id);
  return { tenant: rows[0], sesi_dicabut: dicabut };
}

export async function ubahStatus(
  id: string,
  status: Exclude<StatusTenant, "dibekukan">,
): Promise<{ tenant: Tenant | null; sesi_dicabut: number }> {
  const { rows } = await queryGlobal<Tenant>(
    `UPDATE tenants
        SET status = $2::status_tenant,
            alasan_beku = NULL, dibekukan_pada = NULL, dibekukan_oleh = NULL,
            updated_at = now()
      WHERE id = $1
      RETURNING ${KOLOM}`,
    [id, status],
  );
  if (rows.length === 0) return { tenant: null, sesi_dicabut: 0 };

  // Menonaktifkan juga mencabut sesi. Mengaktifkan tidak: sesi yang sudah
  // dicabut tidak dapat dihidupkan kembali, dan penggunanya cukup masuk lagi.
  const dicabut = status === "nonaktif" ? await cabutSesiTenant(id) : 0;
  return { tenant: rows[0], sesi_dicabut: dicabut };
}

export interface RingkasanTenant extends Tenant {
  domain: string | null;
  warmup_stage: number | null;
  kontak: number;
  kontak_aktif: number;
  kampanye: number;
  terkirim_7h: number;
  bounce_7h: number;
  keluhan_7h: number;
  penekanan: number;
  pengguna: number;
  /** `null` bila belum ada pengiriman 7 hari terakhir — bukan 0. */
  bounce_rate_7h: number | null;
  complaint_rate_7h: number | null;
}

/**
 * Ringkasan seluruh pelanggan untuk satu layar.
 *
 * `bounce_rate` dan `complaint_rate` bernilai `null`, bukan 0, ketika belum
 * ada pengiriman. Perbedaannya menentukan: 0% terbaca sebagai "sangat sehat",
 * padahal artinya "belum ada yang bisa diukur" — kekeliruan yang sama sudah
 * dihindari di `/domain/health` dan tidak boleh masuk lagi lewat layar
 * superadmin, justru layar yang dipakai memutuskan siapa yang dibekukan.
 *
 * WAJIB dipanggil dari konteks superadmin: angka-angkanya dibaca lewat
 * `query()` dan karena itu tunduk pada RLS.
 */
export async function ringkasan(): Promise<RingkasanTenant[]> {
  const { rows } = await query<
    Tenant & Record<string, string | number | null>
  >(
    `SELECT t.id, t.nama, t.slug::text AS slug, t.status::text AS status, t.kuota_kontak,
            t.catatan, t.alasan_beku, t.dibekukan_pada, t.dibekukan_oleh, t.created_at,
            dh.domain, dh.warmup_stage,
            (SELECT count(*) FROM contacts c WHERE c.tenant_id = t.id)::text AS kontak,
            (SELECT count(*) FROM contacts c WHERE c.tenant_id = t.id AND c.status = 'aktif')::text AS kontak_aktif,
            (SELECT count(*) FROM campaigns k WHERE k.tenant_id = t.id)::text AS kampanye,
            (SELECT count(*) FROM suppression s WHERE s.tenant_id = t.id)::text AS penekanan,
            (SELECT count(*) FROM users u WHERE u.tenant_id = t.id)::text AS pengguna,
            r.terkirim, r.bounce, r.keluhan
       FROM tenants t
       LEFT JOIN domain_health dh ON dh.tenant_id = t.id
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE sent_at IS NOT NULL)::text      AS terkirim,
                count(*) FILTER (WHERE bounced_at IS NOT NULL)::text   AS bounce,
                count(*) FILTER (WHERE complained_at IS NOT NULL)::text AS keluhan
           FROM campaign_recipients cr
          WHERE cr.tenant_id = t.id
            AND cr.sent_at > now() - interval '7 days'
       ) r ON true
      ORDER BY t.created_at`,
  );

  return rows.map((baris) => {
    const n = (k: string) => Number(baris[k] ?? 0);
    const terkirim = n("terkirim");
    const rasio = (v: number) =>
      terkirim === 0 ? null : Number(((v / terkirim) * 100).toFixed(2));

    return {
      id: baris.id,
      nama: baris.nama,
      slug: baris.slug,
      status: baris.status,
      kuota_kontak: baris.kuota_kontak,
      catatan: baris.catatan,
      alasan_beku: baris.alasan_beku,
      dibekukan_pada: baris.dibekukan_pada,
      dibekukan_oleh: baris.dibekukan_oleh,
      created_at: baris.created_at,
      domain: (baris.domain as string | null) ?? null,
      warmup_stage: baris.warmup_stage === null ? null : Number(baris.warmup_stage),
      kontak: n("kontak"),
      kontak_aktif: n("kontak_aktif"),
      kampanye: n("kampanye"),
      penekanan: n("penekanan"),
      pengguna: n("pengguna"),
      terkirim_7h: terkirim,
      bounce_7h: n("bounce"),
      keluhan_7h: n("keluhan"),
      bounce_rate_7h: rasio(n("bounce")),
      complaint_rate_7h: rasio(n("keluhan")),
    };
  });
}

/**
 * Memeriksa apakah pelanggan masih boleh mengirim.
 *
 * Dipakai jalur kirim, bukan jalur baca. Pelanggan yang dibekukan tetap dapat
 * membuka datanya — yang berhenti hanyalah pengiriman.
 */
export async function bolehMengirim(
  tenantId: string,
): Promise<{ boleh: boolean; status: StatusTenant; alasan: string | null }> {
  const { rows } = await queryGlobal<{ status: StatusTenant; alasan_beku: string | null }>(
    "SELECT status::text AS status, alasan_beku FROM tenants WHERE id = $1",
    [tenantId],
  );
  const baris = rows[0];
  // Pelanggan yang tidak ditemukan diperlakukan sebagai tidak boleh mengirim.
  // Bawaan yang menolak, bukan yang mengizinkan: baris yang hilang berarti
  // ada yang salah, dan mengirim dalam keadaan itu tidak dapat ditarik.
  if (!baris) return { boleh: false, status: "nonaktif", alasan: "pelanggan tidak ditemukan" };

  return {
    boleh: baris.status === "aktif",
    status: baris.status,
    alasan: baris.alasan_beku,
  };
}

/** Pelanggan yang pengirimannya masih berjalan. Dipakai worker. */
export async function tenantAktif(): Promise<{ id: string; slug: string }[]> {
  const { rows } = await queryGlobal<{ id: string; slug: string }>(
    "SELECT id, slug::text AS slug FROM tenants WHERE status = 'aktif' ORDER BY created_at",
  );
  return rows;
}

/** Semua pelanggan yang belum dinonaktifkan. Dipakai pekerjaan penilaian. */
export async function tenantHidup(): Promise<{ id: string; slug: string }[]> {
  const { rows } = await queryGlobal<{ id: string; slug: string }>(
    "SELECT id, slug::text AS slug FROM tenants WHERE status <> 'nonaktif' ORDER BY created_at",
  );
  return rows;
}

/**
 * Sisa kuota kontak. `null` berarti tanpa batas.
 *
 * Dipanggil dari konteks pelanggan: `count(*)` di bawah sudah tersaring RLS,
 * jadi tidak perlu — dan tidak boleh — menyebut `tenant_id` sendiri.
 */
export async function sisaKuotaKontak(tenantId: string): Promise<number | null> {
  const { rows: batas } = await queryGlobal<{ kuota_kontak: number | null }>(
    "SELECT kuota_kontak FROM tenants WHERE id = $1",
    [tenantId],
  );
  const kuota = batas[0]?.kuota_kontak ?? null;
  if (kuota === null) return null;

  const { rows } = await query<{ n: string }>("SELECT count(*)::text AS n FROM contacts");
  return Math.max(kuota - Number(rows[0].n), 0);
}
