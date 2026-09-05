// Menjalankan satu pekerjaan untuk setiap pelanggan, satu per satu.
//
// Pekerjaan latar tidak punya permintaan HTTP, jadi tidak ada yang memasang
// konteks pelanggan untuknya. Tanpa pembungkus ini, setiap query di dalam job
// akan melempar "tanpa konteks" — dan itu memang perilaku yang diinginkan
// `db.ts`: job yang lupa dibungkus harus gagal keras, bukan diam-diam
// memproses nol baris.
//
// Berurutan, bukan paralel. Alasannya bukan kesederhanaan: seluruh pengiriman
// berbagi satu kolam koneksi dan satu batas kuota per domain, dan menjalankan
// sepuluh pelanggan bersamaan hanya memindahkan pertikaian itu ke tempat yang
// lebih sulit dibaca. Pada volume yang ditargetkan, satu putaran berurutan
// selesai jauh di bawah jeda antar-putaran.
//
// Pilihan `daftar` menentukan siapa yang ikut, dan itu keputusan penting:
//
//   tenantAktif() — HANYA yang boleh mengirim. Dipakai pekerjaan yang
//     menghasilkan email keluar. Pelanggan yang dibekukan harus benar-benar
//     berhenti mengirim, dan penjagaannya ada di sini — di tempat pengiriman
//     sungguhan dijadwalkan — bukan hanya di antarmuka.
//
//   tenantHidup() — termasuk yang dibekukan. Dipakai pekerjaan yang hanya
//     menilai dan menghitung. Pembekuan menghentikan pengiriman, bukan
//     pembukuan: pelanggan yang dibekukan karena reputasinya buruk justru
//     paling perlu angkanya tetap diperbarui supaya dapat dinilai kembali.

import { dalamKonteks } from "../db.js";
import { tenantAktif, tenantHidup } from "../tenants/repo.js";

export type PilihanTenant = "aktif" | "hidup";

export function perTenant(
  pilihan: PilihanTenant,
  nama: string,
  jalankan: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    const daftar = pilihan === "aktif" ? await tenantAktif() : await tenantHidup();
    if (daftar.length === 0) return;

    for (const tenant of daftar) {
      try {
        await dalamKonteks({ tenantId: tenant.id }, jalankan);
      } catch (err) {
        // Satu pelanggan yang gagal tidak boleh menghentikan sisanya.
        // Pekerjaan ini berjalan berulang, jadi kegagalan sesaat akan
        // terobati di putaran berikutnya — yang tidak terobati adalah
        // pelanggan lain yang tidak sempat diproses karena lemparan ini.
        console.error(
          `[${nama}] pelanggan ${tenant.slug} gagal: ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }
  };
}
