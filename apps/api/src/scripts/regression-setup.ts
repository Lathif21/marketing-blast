// Menyiapkan basis data TERPISAH untuk uji regresi, lalu mengarahkan seluruh
// modul ke sana.
//
// Ini bukan kenyamanan — ini pengaman. Uji regresi menjalankan
// `DELETE FROM contacts` untuk membersihkan fixture. Kalau ia menunjuk basis
// data pengembangan, satu kali `npm run test:e2e` menghapus seluruh kontak
// hasil impor. Itu sudah pernah terjadi, dan peringatan di komentar tidak
// mencegahnya. Yang mencegahnya adalah tidak pernah menunjuk ke sana.
//
// Menggeser variabel lingkungan lalu berharap modul lain membacanya belakangan
// TIDAK cukup: `config.ts` menangkap DATABASE_URL saat dievaluasi, dan urutan
// evaluasi ESM terlalu halus untuk dijadikan pengaman. Percobaan pertama lolos
// dari penjaga tapi kolam koneksinya tetap menunjuk basis data pengembangan.
//
// Karena itu proses ini menjalankan ULANG dirinya sendiri sebagai proses anak
// dengan lingkungan yang sudah benar. Proses anak mulai dari nol, jadi tidak
// ada modul yang sempat menangkap nilai lama.

import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { SUFIKS_UJI, gantiNamaBasisData, namaBasisData } from "./regression-guard.js";

const adminUrlAsli = process.env.DATABASE_URL;
if (!adminUrlAsli) throw new Error("DATABASE_URL wajib diisi untuk menjalankan uji regresi.");

const namaAsli = namaBasisData(adminUrlAsli);
if (namaAsli.endsWith(SUFIKS_UJI)) {
  // Sudah menunjuk basis data uji — tidak perlu digeser lagi.
} else {
  const namaUji = `${namaAsli}${SUFIKS_UJI}`;

  // Sambungan ke basis data pemeliharaan, satu-satunya tempat CREATE DATABASE
  // dapat dijalankan.
  const pemeliharaan = new pg.Client({
    connectionString: gantiNamaBasisData(adminUrlAsli, "postgres"),
  });
  await pemeliharaan.connect();
  try {
    const { rowCount } = await pemeliharaan.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      namaUji,
    ]);
    if (rowCount === 0) {
      // CREATE DATABASE tidak menerima parameter terikat; identitasnya dikutip
      // di sisi server lewat format('%I').
      const { rows } = await pemeliharaan.query<{ stmt: string }>(
        "SELECT format('CREATE DATABASE %I', $1::text) AS stmt",
        [namaUji],
      );
      await pemeliharaan.query(rows[0].stmt);
      console.log(`[regresi] basis data ${namaUji} dibuat`);
    }
  } finally {
    await pemeliharaan.end();
  }

  process.env.DATABASE_URL = gantiNamaBasisData(adminUrlAsli, namaUji);
  if (process.env.APP_DATABASE_URL) {
    process.env.APP_DATABASE_URL = gantiNamaBasisData(process.env.APP_DATABASE_URL, namaUji);
  }

  // Migrasi dijalankan sebagai proses terpisah supaya memakai jalur migrasi
  // yang sama persis dengan produksi, bukan salinannya.
  const migrate = fileURLToPath(new URL("../migrate.js", import.meta.url));
  execFileSync(process.execPath, [migrate], {
    stdio: "pipe",
    env: { ...process.env },
  });
  console.log(`[regresi] skema ${namaUji} disiapkan`);

  // Jalankan ulang diri sendiri dengan lingkungan yang sudah benar. Proses
  // anak melihat DATABASE_URL yang sudah berakhiran suffix uji, sehingga blok
  // ini dilewati di sana dan langsung masuk ke pengujian.
  const entri = process.argv[1];
  const anak = spawnSync(process.execPath, [entri, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env },
  });
  process.exit(anak.status ?? 1);
}
