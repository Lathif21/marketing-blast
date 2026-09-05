// Dua kolam koneksi, dua peran berbeda — dan satu konteks pelanggan.
//
// `adminPool` adalah pemilik skema dan hanya dipakai runner migrasi.
// `pool` adalah peran aplikasi yang tidak punya hak DELETE pada `suppression`.
//
// Pemisahan ini yang membuat "daftar penekanan tidak dapat dihapus" jadi
// jaminan basis data, bukan sekadar kesepakatan antar-pengembang.
//
// ── Konteks pelanggan ───────────────────────────────────────────────────────
//
// Sejak migrasi 010 seluruh tabel data pelanggan dilindungi Row Level
// Security, dan policy-nya membaca variabel sesi `app.tenant_id`. Artinya
// setiap query harus berjalan di atas koneksi yang variabelnya sudah disetel —
// dan koneksi dari `Pool` diambil bergiliran, jadi menyetelnya sekali di awal
// proses tidak cukup.
//
// `dalamKonteks()` yang menanganinya: ia memegang SATU koneksi selama satu
// permintaan, menyetel variabelnya, menaruhnya di AsyncLocalStorage, lalu
// mengembalikannya dalam keadaan bersih. `query()` di bawah mengambil koneksi
// itu dari penyimpanan tersebut, sehingga repo tidak perlu meneruskan client
// dari rute ke repo hanya demi konteks.
//
// `query()` MELEMPAR bila tidak ada konteks, dan itu bagian dari rancangannya.
// Alternatifnya — jatuh kembali ke `pool` — akan tetap "bekerja": RLS
// menyembunyikan semua baris, jadi yang muncul adalah daftar kosong, bukan
// galat. Daftar kontak yang kosong padahal datanya ada adalah kegagalan yang
// paling mahal ditelusuri, jauh lebih mahal daripada galat yang terang-terangan
// saat pertama kali dijalankan.

import { AsyncLocalStorage } from "node:async_hooks";
// `pg` masih CommonJS, jadi named import gagal saat dijalankan sebagai ESM
// meski TypeScript menerimanya. Ambil lewat default export.
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

/** Pemilik skema. Hanya untuk migrasi. */
export const adminPool = new Pool({ connectionString: config.db.adminUrl });

/** Peran aplikasi. Dipakai server dan worker. */
export const pool = new Pool({ connectionString: config.db.appUrl });

export interface KonteksTenant {
  /** Pelanggan yang sedang dilayani. `null` hanya untuk konteks superadmin. */
  tenantId: string | null;
  /**
   * Melewati penyaringan RLS. Hanya sesi berperan `superadmin` yang boleh
   * menyetelnya, dan hanya `auth/context.ts` yang menyetelnya.
   */
  superadmin?: boolean;
}

interface Ikatan {
  konteks: KonteksTenant;
  /**
   * Diambil saat query PERTAMA, bukan saat konteks dibuka.
   *
   * Alasannya bentuk siklus permintaan Fastify: konteks harus masuk ke
   * AsyncLocalStorage secara SINKRON di dalam hook `onRequest` supaya seluruh
   * hook dan handler sesudahnya berada di dalamnya — dan mengambil koneksi
   * adalah operasi asinkron. Menunggunya lebih dulu berarti konteksnya hilang
   * sebelum handler berjalan.
   *
   * Efek sampingnya bagus: permintaan yang tidak menyentuh basis data sama
   * sekali — aset statis, healthcheck — tidak pernah memegang koneksi.
   */
  client: pg.PoolClient | null;
  /** Pengambilan yang sedang berjalan, supaya dua query bersamaan tidak mengambil dua koneksi. */
  menunggu: Promise<pg.PoolClient> | null;
}

const penyimpanan = new AsyncLocalStorage<Ikatan>();

/** Konteks yang sedang berlaku, atau `null` di luar `dalamKonteks`. */
export function konteksSaatIni(): KonteksTenant | null {
  return penyimpanan.getStore()?.konteks ?? null;
}

const SETEL =
  "SELECT set_config('app.tenant_id', $1, false), set_config('app.superadmin', $2, false)";
const BERSIHKAN =
  "SELECT set_config('app.tenant_id', '', false), set_config('app.superadmin', 'off', false)";

async function ambilClient(ikatan: Ikatan): Promise<pg.PoolClient> {
  if (ikatan.client) return ikatan.client;
  if (ikatan.menunggu) return ikatan.menunggu;

  ikatan.menunggu = (async () => {
    const client = await pool.connect();
    try {
      await client.query(SETEL, [
        ikatan.konteks.tenantId ?? "",
        ikatan.konteks.superadmin ? "on" : "off",
      ]);
    } catch (err) {
      // Koneksi yang gagal disetel konteksnya TIDAK boleh kembali ke kolam:
      // kalau `set_config` sempat separuh jalan, isinya tidak diketahui.
      client.release(true);
      ikatan.menunggu = null;
      throw err;
    }
    ikatan.client = client;
    return client;
  })();

  return ikatan.menunggu;
}

/**
 * Membuka konteks tanpa menunggu apa pun, untuk dipakai hook `onRequest`.
 * Pasangannya `tutupKonteks` WAJIB dipanggil — di Fastify lewat `onResponse`.
 */
export function bukaKonteks(konteks: KonteksTenant): Ikatan {
  return { konteks, client: null, menunggu: null };
}

/** Menjalankan sisa siklus di dalam konteks. Sinkron, sesuai bentuk hook Fastify. */
export function jalankanDalam(ikatan: Ikatan, lanjut: () => void): void {
  penyimpanan.run(ikatan, lanjut);
}

/**
 * Mengembalikan koneksi ke kolam dalam keadaan bersih.
 *
 * Kalau pembersihannya gagal, koneksinya DIBUANG alih-alih dikembalikan.
 * Koneksi yang masih membawa `app.tenant_id` pelanggan sebelumnya akan
 * melayani permintaan pelanggan lain dengan penyaringan yang salah —
 * kebocoran yang tidak meninggalkan galat sama sekali.
 */
export async function tutupKonteks(ikatan: Ikatan): Promise<void> {
  if (ikatan.menunggu) await ikatan.menunggu.catch(() => {});
  const client = ikatan.client;
  if (!client) return;

  ikatan.client = null;
  ikatan.menunggu = null;

  let bersih = true;
  try {
    await client.query(BERSIHKAN);
  } catch {
    bersih = false;
  }
  client.release(bersih ? undefined : true);
}

/**
 * Menjalankan satu blok atas nama satu pelanggan.
 *
 * Koneksinya dipegang selama blok berjalan, bukan diambil per query. Itu
 * bukan optimasi: variabel sesi menempel pada koneksi, dan mengambil koneksi
 * baru di tengah blok berarti query berikutnya berjalan tanpa konteks.
 *
 * Pembersihan di `finally` adalah bagian paling penting berkas ini. Koneksi
 * yang kembali ke kolam sambil masih membawa `app.tenant_id` pelanggan
 * sebelumnya akan melayani permintaan pelanggan lain dengan penyaringan yang
 * salah — kebocoran yang tidak meninggalkan galat sama sekali. Karena itu
 * kalau pembersihannya sendiri gagal, koneksinya DIBUANG (`release(true)`)
 * alih-alih dikembalikan: kehilangan satu koneksi jauh lebih murah daripada
 * satu koneksi yang tercemar beredar di kolam.
 */
export async function dalamKonteks<T>(
  konteks: KonteksTenant,
  fn: () => Promise<T>,
): Promise<T> {
  const ikatan = bukaKonteks(konteks);
  try {
    return await penyimpanan.run(ikatan, fn);
  } finally {
    await tutupKonteks(ikatan);
  }
}

class TanpaKonteks extends Error {
  constructor() {
    super(
      "Query data pelanggan dijalankan tanpa konteks tenant. " +
        "Bungkus pemanggilnya dengan dalamKonteks(), atau pakai queryGlobal() " +
        "bila memang menyentuh tabel di luar data pelanggan.",
    );
    this.name = "TanpaKonteks";
  }
}

/**
 * Query pada data pelanggan. Wajib berada di dalam `dalamKonteks`.
 *
 * Tidak menerima `tenant_id` sebagai argumen, dan tidak perlu: kolomnya
 * terisi sendiri lewat DEFAULT saat INSERT, dan tersaring sendiri lewat policy
 * saat SELECT, UPDATE, maupun DELETE.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  const ikatan = penyimpanan.getStore();
  if (!ikatan) throw new TanpaKonteks();
  const client = await ambilClient(ikatan);
  return client.query<T>(text, params);
}

/**
 * Query pada tabel di LUAR data pelanggan: `tenants`, `users`, `sessions`,
 * `admin_audit`, dan `job_queue`.
 *
 * Keempat tabel pertama sengaja tidak memakai RLS — merekalah yang menetapkan
 * konteks, jadi menaruhnya di belakang policy yang membutuhkan konteks
 * menghasilkan lingkaran (lihat catatan di migrasi 010).
 *
 * Namanya panjang dan berbeda dengan sengaja: setiap pemakaiannya harus mudah
 * ditemukan saat seseorang bertanya "di mana saja penyaringan pelanggan tidak
 * berlaku".
 */
export async function queryGlobal<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  const ikatan = penyimpanan.getStore();
  // Memakai koneksi konteks kalau memang sudah ada, supaya satu permintaan
  // tetap memakai satu koneksi. Variabel sesi tidak mengganggu: tabel-tabel
  // ini tanpa RLS. Kalau belum ada, TIDAK dipaksa mengambil — autentikasi
  // berjalan sebelum konteks diketahui, dan itu justru pemakai utamanya.
  if (ikatan?.client) return ikatan.client.query<T>(text, params);
  return pool.query<T>(text, params);
}

/** Dipakai healthcheck dan oleh worker sebelum mulai bekerja. */
export async function ping(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    return true;
  } finally {
    client.release();
  }
}

/**
 * Menjalankan satu blok di dalam transaksi, rollback bila melempar.
 *
 * Di dalam `dalamKonteks`, transaksinya berjalan pada koneksi konteks itu —
 * bukan pada koneksi baru. Kalau ia mengambil koneksi sendiri, seluruh query
 * di dalam transaksi akan berjalan tanpa `app.tenant_id` dan tidak melihat
 * satu baris pun.
 */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const ikatan = penyimpanan.getStore();
  if (ikatan) return jalankanTransaksi(await ambilClient(ikatan), fn);

  const client = await pool.connect();
  try {
    return await jalankanTransaksi(client, fn);
  } finally {
    client.release();
  }
}

async function jalankanTransaksi<T>(
  client: pg.PoolClient,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

/**
 * Koneksi konteks yang sedang dipegang, untuk kode yang butuh `PoolClient`
 * secara langsung — pemeriksaan pra-kirim dan kuota harian meneruskannya ke
 * fungsi yang menerima client.
 */
export async function clientKonteks(): Promise<pg.PoolClient> {
  const ikatan = penyimpanan.getStore();
  if (!ikatan) throw new TanpaKonteks();
  return ambilClient(ikatan);
}

export async function close(): Promise<void> {
  await pool.end();
}

export async function closeAll(): Promise<void> {
  await Promise.allSettled([pool.end(), adminPool.end()]);
}
