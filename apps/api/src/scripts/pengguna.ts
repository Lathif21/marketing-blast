// Membuat pengguna dari baris perintah.
//
//   npm run pengguna -- superadmin lathif@contoh.id "Lathif"
//   npm run pengguna -- admin bawaan admin@pelanggan.id "Admin Pelanggan"
//   npm run pengguna -- sandi lathif@contoh.id
//
// Ini satu-satunya jalan masuk pertama ke instalasi baru. Semua rute lain
// menuntut sesi, dan sesi menuntut pengguna — jadi tanpa skrip ini instalasi
// yang baru bermigrasi tidak dapat dimasuki siapa pun.
//
// Sengaja TIDAK berbentuk endpoint "buat superadmin pertama". Endpoint semacam
// itu harus terbuka tanpa autentikasi supaya dapat dipakai, dan endpoint
// terbuka yang membuat superadmin adalah satu permintaan HTTP dari
// pengambilalihan penuh — untuk selamanya, bukan hanya sampai superadmin
// pertama dibuat, karena kesalahan menutupnya kembali tidak akan terlihat.
// Baris perintah menuntut akses ke server, dan itu memang syarat yang tepat.

import { randomBytes } from "node:crypto";
import { closeAll, queryGlobal } from "../db.js";
import {
  buatPengguna,
  cariPenggunaLewatEmail,
  setelSandi,
} from "../auth/repo.js";
import { MIN_PANJANG_SANDI, sandiCukupPanjang } from "../auth/password.js";

/** Sandi acak yang dapat dibacakan lewat telepon tanpa salah dengar. */
function sandiAcak(): string {
  // Tanpa 0/O dan 1/l/I. Panjangnya dinaikkan sebagai gantinya, jadi entropi
  // tidak berkurang — 20 karakter dari 58 alfabet ≈ 117 bit.
  const alfabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const acak = randomBytes(20);
  return Array.from(acak, (b) => alfabet[b % alfabet.length]).join("");
}

function selesai(pesan: string, kode = 0): never {
  console.log(pesan);
  process.exit(kode);
}

const PEMAKAIAN = `
Pemakaian:
  pengguna superadmin <email> <nama> [sandi]
  pengguna admin <slug-pelanggan> <email> <nama> [sandi]
  pengguna operator <slug-pelanggan> <email> <nama> [sandi]
  pengguna sandi <email> [sandi]

Sandi yang tidak diisi akan dibuat acak dan ditampilkan sekali.
`.trim();

async function main() {
  const [perintah, ...sisa] = process.argv.slice(2);

  if (!perintah) selesai(PEMAKAIAN, 1);

  if (perintah === "sandi") {
    const [email, sandiArg] = sisa;
    if (!email) selesai(PEMAKAIAN, 1);

    const pengguna = await cariPenggunaLewatEmail(email);
    if (!pengguna) selesai(`Pengguna ${email} tidak ditemukan.`, 1);

    const sandi = sandiArg ?? sandiAcak();
    if (!sandiCukupPanjang(sandi)) {
      selesai(`Sandi minimal ${MIN_PANJANG_SANDI} karakter.`, 1);
    }

    await setelSandi(pengguna.id, sandi);
    selesai(`Sandi ${email} disetel.\n\n  sandi: ${sandi}\n`);
  }

  if (perintah === "superadmin") {
    const [email, nama, sandiArg] = sisa;
    if (!email || !nama) selesai(PEMAKAIAN, 1);

    if (await cariPenggunaLewatEmail(email)) {
      selesai(`Email ${email} sudah dipakai. Pakai "pengguna sandi ${email}" untuk menyetel ulang.`, 1);
    }

    const sandi = sandiArg ?? sandiAcak();
    if (!sandiCukupPanjang(sandi)) selesai(`Sandi minimal ${MIN_PANJANG_SANDI} karakter.`, 1);

    // `tenantId: null` bukan kelalaian — CHECK di migrasi 010 menuntutnya.
    // Superadmin bukan milik pelanggan mana pun, dan itulah yang
    // membedakannya dari admin pelanggan mana pun yang paling berkuasa.
    const pengguna = await buatPengguna({
      tenantId: null,
      email,
      nama,
      peran: "superadmin",
      sandi,
    });

    selesai(
      `Superadmin dibuat.\n\n  email: ${pengguna.email}\n  sandi: ${sandi}\n\n` +
        "Sandi ini tidak ditampilkan lagi. Simpan sekarang.",
    );
  }

  if (perintah === "admin" || perintah === "operator") {
    const [slug, email, nama, sandiArg] = sisa;
    if (!slug || !email || !nama) selesai(PEMAKAIAN, 1);

    const { rows } = await queryGlobal<{ id: string; nama: string }>(
      "SELECT id, nama FROM tenants WHERE slug = $1",
      [slug],
    );
    if (rows.length === 0) selesai(`Pelanggan dengan slug "${slug}" tidak ditemukan.`, 1);

    if (await cariPenggunaLewatEmail(email)) selesai(`Email ${email} sudah dipakai.`, 1);

    const sandi = sandiArg ?? sandiAcak();
    if (!sandiCukupPanjang(sandi)) selesai(`Sandi minimal ${MIN_PANJANG_SANDI} karakter.`, 1);

    await buatPengguna({
      tenantId: rows[0].id,
      email,
      nama,
      peran: perintah,
      sandi,
    });

    selesai(
      `Pengguna ${perintah} untuk ${rows[0].nama} dibuat.\n\n` +
        `  email: ${email}\n  sandi: ${sandi}\n\n` +
        "Sandi ini tidak ditampilkan lagi. Simpan sekarang.",
    );
  }

  selesai(PEMAKAIAN, 1);
}

main()
  .catch((err) => {
    console.error("gagal:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeAll());
