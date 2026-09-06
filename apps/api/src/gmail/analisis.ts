// Menafsirkan isi kotak masuk menjadi dua hal yang berguna.
//
// Murni: tidak menyentuh basis data, tidak memanggil Google, tidak membaca
// konfigurasi. Ini aturan yang menentukan siapa yang akhirnya dikirimi email
// atas dasar "kita pernah berkorespondensi" — dan klaim itu harus dapat
// dipertanggungjawabkan bila ditanya. Aturan sepenting itu harus dapat diuji
// sendirian, tanpa kotak masuk sungguhan.
//
// Dua keluaran dari satu masukan:
//
//   balasan — pesan masuk yang tampak sebagai balasan atas kampanye kita
//   kontak  — alamat yang benar-benar berkorespondensi DUA ARAH dengan tim
//
// Yang kedua adalah aturan kepatuhan, bukan penyaring kenyamanan. Kotak masuk
// mana pun penuh dengan alamat yang tidak pernah berinteraksi: langganan
// buletin, notifikasi sistem, pendaftaran layanan. Mengirimi mereka kampanye
// adalah persis definisi email tanpa dasar izin, dan tidak ada di antaranya
// yang pernah membalas — karena itu "dua arah" yang menyaringnya, bukan daftar
// hitam kata kunci yang harus terus dikejar.

/** Bentuk pesan yang dibutuhkan analisis. Sengaja tanpa isi pesan. */
export interface PesanRingkas {
  id: string;
  threadId: string;
  /** Milidetik epoch, mengikuti `internalDate` Gmail. */
  waktu: number;
  /** Header `From` apa adanya, misalnya `"Budi" <budi@contoh.id>`. */
  dari: string;
  /** Gabungan `To` dan `Cc`, apa adanya. */
  kepada: string[];
  subjek: string | null;
  inReplyTo: string | null;
  references: string | null;
  /** Ada pada kiriman massal. Kehadirannya saja sudah menjadi penanda. */
  listUnsubscribe?: string | null;
  /** `bulk`, `list`, atau `auto_reply` pada kiriman otomatis. */
  precedence?: string | null;
  /** `auto-replied` pada balasan otomatis di luar kantor. */
  autoSubmitted?: string | null;
}

export interface OpsiAnalisis {
  /** Alamat kotak masuk yang tersambung. Pesan darinya berarti kita yang mengirim. */
  alamatSendiri: string;
  /**
   * Domain yang dianggap internal — rekan kerja, bukan prospek.
   *
   * Diturunkan dari alamat sendiri, dan dapat ditambah. Tanpa ini, impor
   * pertama akan memasukkan seluruh rekan satu kantor sebagai kontak
   * pemasaran, dan yang pertama menerima kampanye perkenalan adalah orang di
   * meja sebelah.
   */
  domainInternal: string[];
}

export interface BalasanTerdeteksi {
  email: string;
  inReplyTo: string | null;
  subjek: string | null;
  waktu: number;
}

export interface KandidatKontak {
  email: string;
  nama: string | null;
  /** Korespondensi terakhir, dipakai mengurutkan dan sebagai tanggal izin. */
  terakhir: number;
  /** Banyaknya pesan dua arah. Satu balasan sudah cukup, lebih banyak lebih kuat. */
  jumlahPesan: number;
}

export interface HasilAnalisis {
  balasan: BalasanTerdeteksi[];
  kontak: KandidatKontak[];
  /** Alasan penolakan beserta jumlahnya, untuk ditampilkan apa adanya ke pengguna. */
  ditolak: Record<AlasanTolak, number>;
}

export type AlasanTolak =
  | "satu_arah"
  | "otomatis"
  | "internal"
  | "kiriman_massal"
  | "tanpa_alamat";

const ALASAN: AlasanTolak[] = [
  "satu_arah",
  "otomatis",
  "internal",
  "kiriman_massal",
  "tanpa_alamat",
];

/**
 * Bagian lokal alamat yang menandakan pengirim mesin.
 *
 * Daftar ini penjaga lapis kedua, bukan pertama. Yang menyaring sebagian besar
 * kiriman otomatis adalah aturan dua arah — mesin tidak membalas. Daftar ini
 * menangkap sisanya: alamat yang kebetulan pernah dibalas manusia, misalnya
 * tiket dukungan yang dijawab lalu ditutup otomatis.
 */
const POLA_OTOMATIS =
  /^(no[-_.]?reply|donotreply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|postmaster|bounce[sd]?|notifications?|alerts?|noreply)/i;

/** `Nama Lengkap <orang@contoh.id>` → `orang@contoh.id`. */
export function alamatDari(raw: string): string | null {
  const kurung = raw.match(/<([^>]+)>/);
  const calon = (kurung ? kurung[1] : raw).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(calon) ? calon.toLowerCase() : null;
}

/** `"Budi Santoso" <budi@contoh.id>` → `Budi Santoso`. */
export function namaDari(raw: string): string | null {
  const sebelumKurung = raw.split("<")[0].trim();
  const bersih = sebelumKurung.replace(/^["']|["']$/g, "").trim();
  // Sebagian klien menaruh alamat itu sendiri sebagai nama tampilan. Itu bukan
  // nama, dan menyimpannya membuat kolom nama perusahaan berisi alamat email.
  if (!bersih || bersih.includes("@")) return null;
  return bersih;
}

/**
 * `<abc@region.amazonses.com>` → `abc@region.amazonses.com`.
 *
 * Kurung sudutnya WAJIB dibuang di sini, bukan di pemanggil. `catatBalasan`
 * mencocokkan nilai ini dengan `campaign_recipients.message_id`, dan
 * pencocokan itu memakai `split_part(..., '@', 1)` untuk menangani bentuk
 * lengkap. Dengan kurung yang masih menempel, potongannya menjadi `<abc` dan
 * tidak pernah cocok dengan apa pun — balasannya terbaca, tercatat sebagai
 * ditemukan, lalu diam-diam tidak tertaut ke penerima mana pun.
 *
 * Jalur webhook SES sudah membuangnya sejak awal (`ses-events.ts`); jalur
 * Gmail sempat tidak, dan uji regresilah yang menemukannya.
 */
export function bersihkanMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const pertama = raw.trim().split(/\s+/)[0];
  if (!pertama) return null;
  return pertama.replace(/^</, "").replace(/>$/, "") || null;
}

export function domainDari(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

export function alamatOtomatis(email: string): boolean {
  return POLA_OTOMATIS.test(email.split("@")[0]);
}

/** Kiriman massal: buletin, notifikasi berlangganan, balasan otomatis. */
export function kirimanMassal(pesan: PesanRingkas): boolean {
  if (pesan.listUnsubscribe) return true;
  const p = pesan.precedence?.toLowerCase();
  if (p === "bulk" || p === "list" || p === "junk") return true;
  const a = pesan.autoSubmitted?.toLowerCase();
  return Boolean(a && a !== "no");
}

/**
 * Menilai satu kumpulan pesan.
 *
 * Urutan penilaian menentukan hasilnya, jadi disusun dari yang paling
 * mengikat:
 *
 *  1. Kiriman massal dan alamat mesin dibuang lebih dulu, sebelum ikut
 *     dihitung sebagai "pernah masuk". Buletin yang kebetulan pernah dibalas
 *     seseorang di tim tetap buletin.
 *  2. Alamat internal dibuang. Rekan kerja bukan prospek.
 *  3. Sisanya harus dua arah: ada pesan DARI mereka dan ada pesan KEPADA
 *     mereka. Satu arah saja — betapa pun banyaknya — tidak menjadi dasar izin.
 */
export function analisis(pesanMasuk: PesanRingkas[], opsi: OpsiAnalisis): HasilAnalisis {
  const sendiri = opsi.alamatSendiri.toLowerCase();
  const internal = new Set(
    [...opsi.domainInternal, domainDari(sendiri)].map((d) => d.toLowerCase()),
  );

  const ditolak = Object.fromEntries(ALASAN.map((a) => [a, 0])) as Record<AlasanTolak, number>;

  /** Alamat yang pernah MENGIRIM ke kita, beserta data tampilannya. */
  const masuk = new Map<string, { nama: string | null; terakhir: number; jumlah: number }>();
  /** Alamat yang pernah KAMI kirimi. */
  const keluar = new Set<string>();

  const balasan: BalasanTerdeteksi[] = [];

  for (const pesan of pesanMasuk) {
    const pengirim = alamatDari(pesan.dari);
    if (!pengirim) {
      ditolak.tanpa_alamat += 1;
      continue;
    }

    const dariKita = pengirim === sendiri;

    if (dariKita) {
      // Pesan yang kita kirim: yang berguna hanyalah kepada siapa.
      for (const tujuan of pesan.kepada) {
        const alamat = alamatDari(tujuan);
        if (alamat && alamat !== sendiri) keluar.add(alamat);
      }
      continue;
    }

    if (kirimanMassal(pesan)) {
      ditolak.kiriman_massal += 1;
      continue;
    }
    if (alamatOtomatis(pengirim)) {
      ditolak.otomatis += 1;
      continue;
    }
    if (internal.has(domainDari(pengirim))) {
      ditolak.internal += 1;
      continue;
    }

    const sebelumnya = masuk.get(pengirim);
    masuk.set(pengirim, {
      nama: sebelumnya?.nama ?? namaDari(pesan.dari),
      terakhir: Math.max(sebelumnya?.terakhir ?? 0, pesan.waktu),
      jumlah: (sebelumnya?.jumlah ?? 0) + 1,
    });

    // Balasan dinilai terpisah dari kelayakan menjadi kontak.
    //
    // Orang yang membalas kampanye BELUM tentu layak menjadi kontak baru — ia
    // sudah menjadi kontak, karena kampanye itu dikirim kepadanya. Yang
    // dibutuhkan di sini hanya fakta bahwa balasannya ada, supaya kampanye
    // tindak lanjut dapat menjaringnya.
    const menjawab =
      Boolean(pesan.inReplyTo) ||
      Boolean(pesan.references) ||
      /^\s*(re|bls|balasan)\s*:/i.test(pesan.subjek ?? "");

    if (menjawab) {
      // `References` dipakai sebagai cadangan, diambil yang TERAKHIR: itulah
      // pesan yang langsung dibalas, sementara yang di depannya adalah leluhur
      // percakapan yang lebih tua.
      const rujukanTerakhir = pesan.references?.trim().split(/\s+/).pop() ?? null;
      balasan.push({
        email: pengirim,
        inReplyTo: bersihkanMessageId(pesan.inReplyTo) ?? bersihkanMessageId(rujukanTerakhir),
        subjek: pesan.subjek,
        waktu: pesan.waktu,
      });
    }
  }

  const kontak: KandidatKontak[] = [];
  for (const [email, data] of masuk) {
    if (!keluar.has(email)) {
      ditolak.satu_arah += 1;
      continue;
    }
    kontak.push({
      email,
      nama: data.nama,
      terakhir: data.terakhir,
      jumlahPesan: data.jumlah,
    });
  }

  // Terbaru lebih dulu: korespondensi paling hangat yang paling layak
  // ditindaklanjuti, dan yang paling mungkin masih diingat penerimanya.
  kontak.sort((a, b) => b.terakhir - a.terakhir);

  return { balasan, kontak, ditolak };
}
