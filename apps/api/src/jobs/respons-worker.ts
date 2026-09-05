// Handler `engagement-recalc` dan `retention-sweep`.
//
// Keduanya berbagi satu penilaian: `contacts.respons`. Yang pertama
// memutakhirkannya, yang kedua melaporkan akibatnya.

import { nilaiUlangRespons, ringkasanRespons } from "../contacts/respons.js";
import { JENDELA_DIAM_HARI } from "../campaign/engagement.js";

export async function runEngagementRecalc(): Promise<void> {
  const hasil = await nilaiUlangRespons();
  if (hasil.diperiksa === 0) return;

  const rincian = Object.entries(hasil.menjadi)
    .map(([k, v]) => `${v} → ${k}`)
    .join(", ");

  console.info(
    `[engagement] ${hasil.diperiksa} kontak dinilai, ${hasil.berubah} berubah` +
      (rincian ? ` (${rincian})` : ""),
  );
}

/**
 * Menyapu kontak tanpa respons.
 *
 * Yang dilakukan hanya MELAPORKAN, bukan menghapus. Penghapusan permanen atas
 * dasar "tidak membuka email selama sebulan" adalah keputusan yang harus
 * diambil orang, dan alasannya bukan kehati-hatian belaka:
 *
 *   * Pembukaan email hanya terdeteksi kalau klien penerima memuat gambar
 *     pelacak. Sebagian besar klien perusahaan memblokirnya secara bawaan,
 *     jadi `diam` mencakup orang yang membaca setiap kata tanpa pernah
 *     terhitung membaca.
 *   * Alamat itu masih dapat dihubungi manusia lewat kanal lain — nomor
 *     telepon dari Contact Harvester tersimpan sebagai `reference_contact`
 *     justru untuk itu.
 *
 * Akibat praktis dari `diam` sudah berjalan tanpa penghapusan: kontaknya tidak
 * memenuhi pemicu tindak lanjut mana pun, jadi ia berhenti menerima kampanye
 * lanjutan dengan sendirinya. Itulah "dihiraukan". Penghapusannya tersedia
 * lewat `POST /contacts/retensi/hapus`, dilakukan orang, dan tercatat atas
 * nama siapa.
 */
export async function runRetentionSweep(): Promise<void> {
  const ringkasan = await ringkasanRespons();
  if (ringkasan.diam === 0) return;

  console.info(
    `[retensi] ${ringkasan.diam} kontak tanpa respons lebih dari ${JENDELA_DIAM_HARI} hari. ` +
      "Tidak dihapus otomatis — tinjau di layar Tindak Lanjut.",
  );
}
