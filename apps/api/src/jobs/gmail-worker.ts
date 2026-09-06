// Handler `gmail-sync`.
//
// Menyinkronkan setiap kotak masuk yang tersambung, satu per satu. Dibungkus
// `perTenant` di `jobs/index.ts`, jadi setiap putaran sudah berada di dalam
// konteks pelanggan yang benar.
//
// Kegagalan satu koneksi tidak boleh menghentikan koneksi lain, dan yang lebih
// penting: kegagalan izin harus MENGUBAH KEADAAN koneksi, bukan sekadar
// tercatat di log. Koneksi yang izinnya habis lalu dicoba lagi tiap sepuluh
// menit selamanya menghasilkan ribuan baris log dan nol perbaikan — yang
// dibutuhkan pengguna adalah satu tanda di layarnya bahwa ia harus
// menyambungkan ulang.

import * as repo from "../gmail/repo.js";
import { GalatOAuth, integrasiAktif, segarkanToken } from "../gmail/oauth.js";
import { GalatGmail, klienGoogle } from "../gmail/klien.js";
import { sinkronkan } from "../gmail/sinkron.js";

export async function runGmailSync(): Promise<void> {
  if (!integrasiAktif()) return;

  const daftar = await repo.koneksiAktif();
  if (daftar.length === 0) return;

  for (const koneksi of daftar) {
    try {
      const penyegar = await repo.tokenPenyegar(koneksi.id);
      if (!penyegar) {
        // Token ada di basis data tapi tidak dapat didekripsi — paling sering
        // karena TOKEN_SECRET berganti. Ditandai perlu disambung ulang, karena
        // memang itu satu-satunya pemulihannya.
        await repo.catatGalat(koneksi.id, "token penyegar tidak dapat dibaca", true);
        continue;
      }

      const token = await segarkanToken(penyegar);
      const hasil = await sinkronkan(koneksi, klienGoogle(token.accessToken));

      await repo.catatSinkron(koneksi.id, {
        sampai: hasil.sampai,
        balasan: hasil.balasan,
        kontak: hasil.kontakBaru,
      });

      if (hasil.balasan > 0 || hasil.kontakBaru > 0) {
        console.info(
          `[gmail] ${koneksi.email}: ${hasil.dibaca} pesan dibaca, ` +
            `${hasil.balasan} balasan tercatat, ${hasil.kontakBaru} kontak baru`,
        );
      }
    } catch (err) {
      const perlu =
        (err instanceof GalatOAuth && err.perluSambungUlang) ||
        (err instanceof GalatGmail && err.perluSambungUlang);
      const pesan = err instanceof Error ? err.message : String(err);

      await repo.catatGalat(koneksi.id, pesan, perlu).catch(() => {});
      console.error(
        `[gmail] ${koneksi.email} gagal${perlu ? " (perlu sambung ulang)" : ""}: ${pesan}`,
      );
    }
  }
}
