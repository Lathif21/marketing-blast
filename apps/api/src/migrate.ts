// Runner migrasi. Berkas SQL bernomor, satu transaksi per berkas, dicatat di
// tabel `schema_migrations`. Tanpa dependensi tambahan — pada jumlah tabel
// segini, alat migrasi penuh hanya menambah yang harus dipelajari.
//
//   npm run migrate
//
// Idempoten: berkas yang sudah tercatat dilewati.

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { PoolClient } from "pg";
import { config } from "./config.js";
import { adminPool, closeAll } from "./db.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

/** Kunci advisory supaya dua proses tidak bermigrasi bersamaan. */
const LOCK_ID = 8_531_207;

async function ensureMigrationsTable(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedVersions(client: PoolClient): Promise<Set<string>> {
  const { rows } = await client.query<{ version: string }>(
    "SELECT version FROM schema_migrations",
  );
  return new Set(rows.map((r) => r.version));
}

async function runMigrations(client: PoolClient): Promise<number> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const applied = await appliedVersions(client);

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.info(`[migrate] ${file}: sudah pernah dijalankan`);
      continue;
    }

    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.info(`[migrate] ${file}: diterapkan`);
      ran++;
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Migrasi ${file} gagal: ${(err as Error).message}`, { cause: err });
    }
  }
  return ran;
}

/**
 * Peran yang dipakai API dan worker sehari-hari. Sengaja tidak sama dengan
 * pemilik skema: pemilik selalu bisa menghapus apa pun, jadi aturan "daftar
 * penekanan tidak dapat dihapus" tidak akan pernah benar-benar mengikat kalau
 * aplikasi terhubung sebagai pemilik.
 *
 * Peran ini mendapat DELETE pada tabel yang memang perlu (pembatalan batch),
 * dan tidak pernah pada `suppression`.
 */
async function ensureAppRole(client: PoolClient) {
  const { user, password } = config.db.appRole;

  if (!password) {
    console.warn(
      "[migrate] APP_DB_PASSWORD kosong — peran aplikasi tidak dibuat. " +
        "Aplikasi akan terhubung sebagai pemilik skema, dan larangan DELETE " +
        "pada suppression TIDAK aktif.",
    );
    return;
  }

  // DDL tidak menerima parameter terikat, jadi identitas dan literal dikutip
  // di sisi server lewat format() — bukan digabung sebagai string di sini.
  const { rows } = await client.query<{ stmt: string }>(
    `SELECT format('%I', $1::text) AS stmt`,
    [user],
  );
  const roleIdent = rows[0].stmt;

  const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [user]);
  if (exists.rowCount === 0) {
    const { rows: create } = await client.query<{ stmt: string }>(
      `SELECT format('CREATE ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS stmt`,
      [user, password],
    );
    await client.query(create[0].stmt);
    console.info(`[migrate] peran ${user} dibuat`);
  } else {
    const { rows: alter } = await client.query<{ stmt: string }>(
      `SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS stmt`,
      [user, password],
    );
    await client.query(alter[0].stmt);
    console.info(`[migrate] kata sandi peran ${user} disegarkan`);
  }

  const dbName = (await client.query<{ current_database: string }>("SELECT current_database()"))
    .rows[0].current_database;
  const { rows: dbIdent } = await client.query<{ stmt: string }>(
    `SELECT format('%I', $1::text) AS stmt`,
    [dbName],
  );

  await client.query(`GRANT CONNECT ON DATABASE ${dbIdent[0].stmt} TO ${roleIdent}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${roleIdent}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ${roleIdent}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${roleIdent}`);

  // DELETE hanya pada tabel yang memang perlu dihapus barisnya.
  await client.query(`GRANT DELETE ON contacts, import_batches, job_queue TO ${roleIdent}`);

  // Dan tidak pernah pada suppression, meski GRANT di atas sempat menyapu
  // seluruh tabel. Urutannya penting: revoke datang terakhir.
  await client.query(`REVOKE DELETE, TRUNCATE ON suppression FROM ${roleIdent}`);
  await client.query(`REVOKE UPDATE ON suppression FROM ${roleIdent}`);

  console.info(`[migrate] hak peran ${user} disetel (tanpa DELETE pada suppression)`);
}

async function main() {
  const client = await adminPool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await ensureMigrationsTable(client);
    const ran = await runMigrations(client);
    await ensureAppRole(client);
    console.info(`[migrate] selesai — ${ran} migrasi baru diterapkan`);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    client.release();
    await closeAll();
  }
}

main().catch((err) => {
  console.error("[migrate] gagal:", err);
  process.exit(1);
});
