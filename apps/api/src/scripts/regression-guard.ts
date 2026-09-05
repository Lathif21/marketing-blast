// Penjaga basis data uji, dipisah supaya dapat diuji sendiri.
//
// Modul ini sengaja TIDAK punya efek samping: mengimpornya tidak membuat basis
// data, tidak menjalankan migrasi, tidak menjalankan ulang proses. Versi
// sebelumnya menempel di modul penyiapan, sehingga satu-satunya cara mengujinya
// adalah menjalankan seluruh rangkaian — dan penjaga yang tidak diuji adalah
// persis jenis kode yang diam-diam berhenti bekerja.

export const SUFIKS_UJI = "_regresi";

export function namaBasisData(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}

export function gantiNamaBasisData(url: string, nama: string): string {
  const u = new URL(url);
  u.pathname = `/${nama}`;
  return u.toString();
}

/**
 * Menolak melanjutkan bila target bukan basis data uji.
 *
 * Menerima URL yang BENAR-BENAR dipakai kolam koneksi, bukan membaca
 * `process.env` sendiri. Versi pertama membaca `process.env` dan lolos padahal
 * kolam koneksinya masih menunjuk basis data pengembangan — penjaga yang
 * memeriksa hal yang salah lebih berbahaya daripada tidak ada penjaga, karena
 * ia memberi rasa aman.
 */
export function pastikanBasisDataUji(urlYangDipakai: string): void {
  const nama = namaBasisData(urlYangDipakai);
  if (!nama.endsWith(SUFIKS_UJI)) {
    throw new Error(
      `Uji regresi menolak berjalan terhadap basis data "${nama}". ` +
        `Uji ini menghapus seluruh isi tabel, dan hanya boleh menyentuh ` +
        `basis data berakhiran "${SUFIKS_UJI}".`,
    );
  }
}
