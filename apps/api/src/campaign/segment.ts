// Penerjemah `segment_filter` menjadi kondisi SQL.
//
// SATU sumber untuk dua pemakai: `susunAntrean` yang benar-benar memasukkan
// penerima ke antrean, dan `hitungAudiens` yang dipakai pemeriksaan pra-kirim.
//
// Sebelumnya keduanya menulis kondisinya sendiri-sendiri. Selama isinya sama
// itu tidak terasa, tapi begitu satu kriteria ditambahkan hanya di satu sisi,
// pra-kirim melaporkan jumlah audiens yang BERBEDA dari yang benar-benar
// diantrekan — dan angka yang dipakai memutuskan boleh-tidaknya mengirim
// menjadi angka yang salah. Menambahkan `contact_ids` ke salah satunya saja
// akan menghasilkan persis kegagalan itu.
//
// Kunci yang tidak dikenali diabaikan, bukan ditolak diam-diam menjadi
// "kirim ke semua": kondisi selalu dimulai dari yang paling sempit.

export interface KondisiSegmen {
  /** Potongan SQL yang digabung dengan AND. Sudah memakai alias `c` dan `s`. */
  kondisi: string[];
  params: unknown[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Kolom waktu yang mewakili setiap pemicu tindak lanjut.
 *
 * Dipetakan lewat tabel tetap, tidak disusun dari nilai yang masuk. Nilai
 * pemicu berasal dari basis data hari ini, tapi kunci yang tidak dikenal harus
 * berakhir sebagai "tidak ada penerima" — bukan sebagai potongan SQL.
 */
const KOLOM_PEMICU: Record<string, string> = {
  membalas: "rk.replied_at",
  diklik: "rk.clicked_at",
  dibuka: "rk.opened_at",
  // Reaksi apa pun. GREATEST mengabaikan NULL, jadi yang hanya membuka tetap
  // terhitung.
  apa_saja: "GREATEST(rk.opened_at, rk.clicked_at, rk.replied_at)",
};

export const SEMUA_PEMICU = Object.keys(KOLOM_PEMICU);

/** Batas jeda tindak lanjut, sama dengan CHECK pada migrasi 009. */
const MAKS_JEDA_JAM = 24 * 90;

/** Keadaan respons yang dikenali. Sama dengan enum `respons_kontak`. */
const RESPONS = ["belum_ada", "menunggu", "tertarik", "menolak", "diam"];

/** Batas jumlah penerima yang dapat dipilih satu per satu. */
export const MAKS_PILIH_MANUAL = 5000;

/**
 * @param mulaiDari jumlah parameter yang sudah dipakai pemanggil, supaya
 *   penomoran `$n` menyambung dan tidak bertabrakan.
 */
export function kondisiSegmen(
  filter: Record<string, unknown>,
  mulaiDari = 0,
): KondisiSegmen {
  const kondisi: string[] = [];
  const params: unknown[] = [];
  const nomor = () => mulaiDari + params.length;

  if (typeof filter.consent_source === "string") {
    params.push(filter.consent_source);
    kondisi.push(`c.consent_source = $${nomor()}`);
  }

  if (typeof filter.domain === "string") {
    params.push(filter.domain);
    kondisi.push(`c.domain = $${nomor()}`);
  }

  // Pemilihan penerima satu per satu.
  //
  // Ini yang membuat kampanye dapat dibatasi agar muat dalam kuota harian:
  // memilih 50 kontak saat batas pemanasan 50 lebih berguna daripada memilih
  // seluruh segmen lalu ditahan pra-kirim.
  if (Array.isArray(filter.contact_ids)) {
    const ids = [...new Set(filter.contact_ids)]
      .filter((v): v is string => typeof v === "string" && UUID.test(v))
      .slice(0, MAKS_PILIH_MANUAL);

    // Daftar kosong berarti "tidak ada yang dipilih", BUKAN "tidak ada
    // pembatasan". Menganggapnya tanpa pembatasan akan mengirim ke seluruh
    // basis kontak justru saat pengguna mengira tidak memilih siapa pun.
    params.push(ids);
    kondisi.push(`c.id = ANY($${nomor()}::uuid[])`);
  }

  if (typeof filter.respons === "string" && RESPONS.includes(filter.respons)) {
    params.push(filter.respons);
    kondisi.push(`c.respons = $${nomor()}::respons_kontak`);
  }

  if (Array.isArray(filter.kecuali_respons)) {
    const daftar = filter.kecuali_respons.filter(
      (v): v is string => typeof v === "string" && RESPONS.includes(v),
    );
    if (daftar.length > 0) {
      params.push(daftar);
      kondisi.push(`c.respons <> ALL($${nomor()}::respons_kontak[])`);
    }
  }

  // Inti kampanye tindak lanjut: penerima kampanye sebelumnya yang bereaksi
  // sesuai pemicu, dan reaksinya sudah cukup lama untuk ditindaklanjuti.
  //
  // Disaring lewat `campaign_recipients`, bukan lewat `contacts.respons`.
  // Keduanya terlihat mirip tapi menjawab pertanyaan yang berbeda:
  // `contacts.respons` berkata "orang ini pernah tertarik pada sesuatu",
  // sedangkan tindak lanjut menanyakan "orang ini bereaksi pada KAMPANYE INI".
  // Memakai yang pertama akan mengirimi lanjutan kampanye A kepada orang yang
  // dulu membuka kampanye B dan tidak pernah menerima perkenalan A sama
  // sekali — pesan yang merujuk percakapan yang tidak pernah terjadi.
  const respons = filter.respons_kampanye;
  if (respons && typeof respons === "object" && !Array.isArray(respons)) {
    const r = respons as Record<string, unknown>;
    const campaignId = typeof r.campaign_id === "string" && UUID.test(r.campaign_id)
      ? r.campaign_id
      : null;
    const kolom = typeof r.pemicu === "string" ? KOLOM_PEMICU[r.pemicu] : undefined;

    // Induk atau pemicu yang tidak dikenali menghasilkan kondisi yang tidak
    // pernah benar, bukan kondisi yang hilang. Kriteria yang menguap diam-diam
    // akan mengubah kampanye lanjutan menjadi kiriman ke seluruh basis kontak.
    if (!campaignId || !kolom) {
      kondisi.push("false");
    } else {
      const jam = Number(r.jeda_jam);
      const jeda = Number.isFinite(jam) ? Math.min(Math.max(Math.floor(jam), 0), MAKS_JEDA_JAM) : 0;

      params.push(campaignId);
      const pId = nomor();
      params.push(jeda);
      const pJeda = nomor();

      kondisi.push(
        `EXISTS (SELECT 1 FROM campaign_recipients rk
                  WHERE rk.contact_id = c.id
                    AND rk.campaign_id = $${pId}
                    AND ${kolom} IS NOT NULL
                    AND ${kolom} <= now() - make_interval(hours => $${pJeda}))`,
      );
    }
  }

  return { kondisi, params };
}
