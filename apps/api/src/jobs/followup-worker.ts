// Handler `followup-enroll`.
//
// Mendaftarkan penerima kampanye perkenalan yang bereaksi ke kampanye tindak
// lanjutnya. Berjalan berulang, bukan sekali saat kampanye lanjutan dibuat:
// reaksi datang selama berhari-hari, dan orang yang membuka email di hari
// kelima sama layaknya ditindaklanjuti dengan yang membuka di hari pertama.
//
// Seluruh pekerjaannya dilakukan `susunAntrean`, yang sudah dipakai jalur
// kirim biasa. Itu disengaja: penjagaan yang melekat di sana — penyaringan
// daftar penekanan dan kontak non-aktif di dalam SQL penyisipan, dan
// `ON CONFLICT DO NOTHING` yang membuat pengulangan tidak menghasilkan kirim
// ganda — berlaku sama untuk tindak lanjut. Jalur pendaftaran sendiri berarti
// penjagaan itu harus ditulis ulang, dan yang ditulis ulang adalah yang
// pertama tertinggal saat aturannya berubah.
//
// Yang menahan pesan agar tidak keluar terlalu cepat bukan pekerjaan ini
// melainkan `jeda_lanjutan_jam` di dalam segmennya: orang yang baru membalas
// lima menit lalu belum memenuhi kondisi, jadi belum masuk antrean sama
// sekali. Menahannya di sini — mendaftarkan lalu menunda pengiriman — akan
// membuat jeda itu tidak terlihat di antrean, dan antrean yang isinya belum
// tentu boleh dikirim adalah antrean yang tidak bisa dipercaya.

import { lanjutanBergulir, susunAntrean } from "../campaign/repo.js";

export async function runFollowupWorker(): Promise<void> {
  const daftar = await lanjutanBergulir();
  if (daftar.length === 0) return;

  for (const kampanye of daftar) {
    try {
      const hasil = await susunAntrean(kampanye.id);
      if (hasil.diantrekan > 0) {
        console.info(
          `[followup] ${kampanye.name}: ${hasil.diantrekan} penerima baru ` +
            `(pemicu ${kampanye.pemicu}, jeda ${kampanye.jeda_lanjutan_jam} jam)`,
        );
      }
    } catch (err) {
      // Satu kampanye yang gagal tidak boleh menghentikan sisanya. Pekerjaan
      // ini berjalan berulang, jadi kegagalan sesaat akan terobati sendiri di
      // putaran berikutnya — yang tidak terobati adalah kampanye lain yang
      // tidak sempat diproses karena lemparan ini.
      console.error(
        `[followup] ${kampanye.id} gagal: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
