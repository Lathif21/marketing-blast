// Dua kolam koneksi, dua peran berbeda.
//
// `adminPool` adalah pemilik skema dan hanya dipakai runner migrasi.
// `pool` adalah peran aplikasi yang tidak punya hak DELETE pada `suppression`.
//
// Pemisahan ini yang membuat "daftar penekanan tidak dapat dihapus" jadi
// jaminan basis data, bukan sekadar kesepakatan antar-pengembang.

// `pg` masih CommonJS, jadi named import gagal saat dijalankan sebagai ESM
// meski TypeScript menerimanya. Ambil lewat default export.
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

/** Pemilik skema. Hanya untuk migrasi. */
export const adminPool = new Pool({ connectionString: config.db.adminUrl });

/** Peran aplikasi. Dipakai server dan worker. */
export const pool = new Pool({ connectionString: config.db.appUrl });

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

/** Menjalankan satu blok di dalam transaksi, rollback bila melempar. */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function close(): Promise<void> {
  await pool.end();
}

export async function closeAll(): Promise<void> {
  await Promise.allSettled([pool.end(), adminPool.end()]);
}
