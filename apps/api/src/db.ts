// `pg` masih CommonJS, jadi named import gagal saat dijalankan sebagai ESM
// meski TypeScript menerimanya. Ambil lewat default export.
import pg from "pg";
import { config } from "./config.js";

const { Pool } = pg;

export const pool = new Pool({ connectionString: config.databaseUrl });

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

export async function close(): Promise<void> {
  await pool.end();
}
