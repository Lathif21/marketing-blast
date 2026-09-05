// Uji regresi yang membutuhkan PostgreSQL sungguhan.
//
//   npm run dev:db          # dari root repo
//   npm run test:e2e        # dari apps/api
//
// Dipisah dari `npm test` karena `npm test` harus tetap bisa jalan tanpa
// basis data. Yang diuji di sini justru hal-hal yang tidak dapat dibuktikan
// tanpa Postgres: kuota, penekanan, transaksi, dan hak peran aplikasi.
//
// Berkas ini permanen dan dimaksudkan untuk dijalankan ulang. Skrip verifikasi
// sekali pakai tidak menahan regresi apa pun — begitu dihapus, jaminannya ikut
// hilang.

// WAJIB paling atas: menggeser DATABASE_URL ke basis data uji SEBELUM `db.ts`
// dievaluasi dan membuat kolam koneksinya.
import "./regression-setup.js";
import { pastikanBasisDataUji } from "./regression-guard.js";

import pg from "pg";
import { adminPool, dalamKonteks, pool, query, transaction } from "../db.js";
import { config } from "../config.js";
import * as kampanye from "../campaign/repo.js";
import { preflight } from "../campaign/preflight.js";
import { kuotaHariIni, pakaiKuota } from "../domain/quota.js";
import { runSendWorker } from "../jobs/send-worker.js";
import { tanggalMuat } from "../domain/warmup.js";
import { suppressByUnsubscribeId } from "../suppression/repo.js";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "../lib/tokens.js";
import { aktifkanKontak, karantinakanKontak } from "../contacts/activate.js";
import * as tenantRepo from "../tenants/repo.js";
import { buatPengguna, bacaSesi, buatSesi, verifikasiKredensial } from "../auth/repo.js";
import { hashSandi, sandiCocok } from "../auth/password.js";
import { runFollowupWorker } from "../jobs/followup-worker.js";
import { nilaiUlangRespons, hapusKontakDiam } from "../contacts/respons.js";
import { JENDELA_DIAM_HARI } from "../campaign/engagement.js";

let gagal = 0;
let jumlah = 0;

function ok(nama: string, lulus: boolean, detail = "") {
  jumlah += 1;
  if (!lulus) gagal += 1;
  console.log(`${lulus ? "ok   " : "GAGAL"}  ${nama}${detail ? " — " + detail : ""}`);
}

function bagian(judul: string) {
  console.log(`\n── ${judul} ──`);
}

const DOMAIN = config.sender.domain;

/**
 * Pelanggan yang memiliki seluruh fixture.
 *
 * Sejak multi-tenant, tidak ada satu pun query data pelanggan yang berjalan
 * tanpa konteks — `db.ts` melemparnya. Uji ini karena itu membuat satu
 * pelanggan di awal dan membungkus setiap bagian dengan `dalamKonteks`.
 *
 * Fixture disisipkan lewat koneksi PEMILIK, yang melewati Row Level Security
 * dan karena itu TIDAK mendapat `tenant_id` dari DEFAULT. Setiap INSERT
 * fixture harus menyebutkan `tenant_id` sendiri — kalau lupa, yang muncul
 * adalah pelanggaran NOT NULL, bukan baris tanpa pemilik. Itu memang bentuk
 * kegagalan yang diinginkan.
 */
let TENANT = "";
let TENANT_LAIN = "";

async function siapkanTenant() {
  pastikanBasisDataUji(config.db.adminUrl);
  await adminPool.query("DELETE FROM sessions");
  await adminPool.query("DELETE FROM users");
  await adminPool.query("DELETE FROM admin_audit");
  await adminPool.query("DELETE FROM tenants");

  const { rows } = await adminPool.query<{ id: string }>(
    `INSERT INTO tenants (nama, slug) VALUES ('Uji Regresi', 'regresi')
     RETURNING id`,
  );
  TENANT = rows[0].id;

  const { rows: lain } = await adminPool.query<{ id: string }>(
    `INSERT INTO tenants (nama, slug) VALUES ('Uji Tetangga', 'tetangga')
     RETURNING id`,
  );
  TENANT_LAIN = lain[0].id;
}

/** Menjalankan satu bagian uji atas nama pelanggan uji utama. */
const sebagaiTenant = <T>(fn: () => Promise<T>) => dalamKonteks({ tenantId: TENANT }, fn);

/**
 * Fixture disiapkan dan dibersihkan lewat koneksi PEMILIK, bukan peran
 * aplikasi. Ini bukan kemudahan — ini bagian dari yang diuji: peran aplikasi
 * memang TIDAK boleh menghapus kampanye maupun daftar penekanan, dan skrip uji
 * yang memakai koneksi aplikasi untuk membersihkan justru akan menuntut hak
 * yang seharusnya tidak dimilikinya.
 *
 * Perilaku aplikasi yang diuji di bawah tetap memakai peran aplikasi, lewat
 * fungsi-fungsi aslinya.
 */
async function bersihkan() {
  // Diperiksa setiap kali, bukan sekali di awal. Satu pemeriksaan di awal
  // tidak menolong kalau ada yang memanggil bersihkan() dari tempat lain.
  pastikanBasisDataUji(config.db.adminUrl);
  await adminPool.query("DELETE FROM campaign_recipients");
  await adminPool.query("DELETE FROM campaigns");
  await adminPool.query("DELETE FROM contacts");
  await adminPool.query("DELETE FROM import_batches");
  await adminPool.query("DELETE FROM domain_daily_sends");
  await adminPool.query("DELETE FROM domain_health");
  await adminPool.query("DELETE FROM suppression");
  // `tenants` TIDAK dihapus di sini: `TENANT` memegang id-nya, dan seluruh
  // bagian uji berjalan di dalam konteks itu. Menghapusnya di tengah jalan
  // membuat konteks menunjuk pelanggan yang sudah tidak ada — dan RLS lalu
  // menyembunyikan setiap baris, sehingga yang gagal adalah uji berikutnya,
  // bukan yang salah.
}

async function buatKontak(jumlahKontak: number, prefix: string) {
  const nilai: string[] = [];
  const params: unknown[] = [];
  for (let i = 0; i < jumlahKontak; i += 1) {
    const n = params.length;
    params.push(`${prefix}${i}@uji.id`, "uji.id", `PT Uji ${i}`, TENANT);
    nilai.push(
      `($${n + 1}, $${n + 2}, $${n + 3}, 'formulir_web', 'kuat', 'found', 'aktif', $${n + 4})`,
    );
  }
  await adminPool.query(
    `INSERT INTO contacts (email, domain, company_name, consent_source,
                           consent_strength, email_origin, status, tenant_id)
     VALUES ${nilai.join(", ")}`,
    params,
  );
}

async function setTahap(stage: number) {
  await adminPool.query(
    `INSERT INTO domain_health (domain, warmup_stage, tenant_id) VALUES ($1, $2, $3)
     ON CONFLICT (domain) DO UPDATE SET warmup_stage = $2`,
    [DOMAIN, stage, TENANT],
  );
}

async function hitungStatus(campaignId: string) {
  const { rows } = await adminPool.query<{ status: string; n: string }>(
    `SELECT status::text AS status, count(*)::text AS n
       FROM campaign_recipients WHERE campaign_id = $1 GROUP BY status`,
    [campaignId],
  );
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Record<string, number>;
}

async function terpakaiHariIni(): Promise<number> {
  const { rows } = await adminPool.query<{ sent_count: number }>(
    "SELECT sent_count FROM domain_daily_sends WHERE domain = $1 AND send_date = CURRENT_DATE",
    [DOMAIN],
  );
  return rows[0]?.sent_count ?? 0;
}

async function buatKampanye(nama: string) {
  return kampanye.create({
    name: nama,
    subject: "Penawaran untuk {{nama_perusahaan}}",
    bodyText: "Yth. {{nama_perusahaan}},\n\nIsi pesan uji.",
    bodyHtml: null,
    senderDomain: DOMAIN,
    segmentFilter: {},
  });
}

// ════════════════════════════════════════════════════════════════════════════

async function ujiKuotaDanPreflight() {
  bagian("Preflight — kuota harian menahan volume berlebih");

  await bersihkan();
  await setTahap(1); // batas 50/hari
  await buatKontak(60, "a");

  const c = await buatKampanye("Uji preflight");
  const antre = await kampanye.susunAntrean(c.id);
  ok("antrean tersusun untuk seluruh kontak aktif", antre.diantrekan === 60, `${antre.diantrekan} diantre`);

  const hasil = await preflight(c.id);
  ok("preflight memblokir volume di atas kuota", hasil.dapat_dikirim === false);

  const butirKuota = hasil.pemeriksaan.find((b) => b.butir === "batas_pemanasan");
  ok("butir batas_pemanasan gagal", butirKuota?.lolos === false, butirKuota?.pesan ?? "");

  ok("sisa kuota dilaporkan 50", hasil.ringkasan.sisa_kuota === 50, `${hasil.ringkasan.sisa_kuota}`);

  const hariIni = new Date().toISOString().slice(0, 10);
  ok(
    "tanggal_muat menawarkan tanggal di masa depan",
    typeof hasil.ringkasan.tanggal_muat === "string" && hasil.ringkasan.tanggal_muat > hariIni,
    String(hasil.ringkasan.tanggal_muat),
  );

  // 60 penerima, sisa 50 hari ini, batas berikutnya 50 → sisa 10 besok.
  ok(
    "tanggal_muat memakai batas harian penuh untuk hari berikutnya, bukan sisa hari ini",
    hasil.ringkasan.tanggal_muat === tanggalMuat(50, 60, 50),
    `${hasil.ringkasan.tanggal_muat} vs ${tanggalMuat(50, 60, 50)}`,
  );

  return c.id;
}

async function ujiPengirimanBerhentiDiKuota() {
  bagian("send-worker — berhenti di batas, sisanya tetap queued");

  await bersihkan();
  await setTahap(1); // 50/hari
  await buatKontak(60, "b");

  const c = await buatKampanye("Uji kirim");
  await kampanye.susunAntrean(c.id);
  await kampanye.ubahStatus(c.id, "terjadwal");

  await runSendWorker();

  const status = await hitungStatus(c.id);
  ok("tepat 50 terkirim, sesuai batas tahap 1", status.sent === 50, JSON.stringify(status));
  ok("10 sisanya tetap queued, bukan failed", status.queued === 10, JSON.stringify(status));
  ok("tidak ada baris failed", (status.failed ?? 0) === 0, JSON.stringify(status));

  const terpakai = await terpakaiHariIni();
  ok("domain_daily_sends bertambah tepat sejumlah terkirim", terpakai === 50, `${terpakai}`);

  const setelah = await kampanye.get(c.id);
  ok(
    "kampanye belum selesai selagi masih ada queued",
    setelah?.status === "berjalan",
    String(setelah?.status),
  );

  // Putaran kedua pada hari yang sama tidak boleh mengirim apa pun lagi.
  await runSendWorker();
  const status2 = await hitungStatus(c.id);
  ok("putaran kedua tidak menambah kiriman", status2.sent === 50, JSON.stringify(status2));
  ok("sisanya masih queued", status2.queued === 10, JSON.stringify(status2));
  ok("kuota tidak bertambah", (await terpakaiHariIni()) === 50);
}

async function ujiPenekananSetelahAntre() {
  bagian("send-worker — penekanan setelah antrean disusun");

  await bersihkan();
  await setTahap(3); // 500/hari, cukup untuk semua
  await buatKontak(5, "c");

  const c = await buatKampanye("Uji penekanan");
  await kampanye.susunAntrean(c.id);
  await kampanye.ubahStatus(c.id, "terjadwal");

  // Berhenti berlangganan terjadi SETELAH antrean disusun.
  await adminPool.query(
    // `tenant_id` disebut eksplisit: koneksi PEMILIK tidak punya
    // `app.tenant_id`, jadi DEFAULT app_tenant() akan menghasilkan NULL dan
    // INSERT-nya gagal. Fixture yang ditulis lewat koneksi pemilik harus
    // selalu menyebutkan pemiliknya sendiri.
    "INSERT INTO suppression (email, reason, tenant_id) VALUES ($1, 'unsubscribe', $2)",
    ["c2@uji.id", TENANT],
  );

  await runSendWorker();

  const status = await hitungStatus(c.id);
  ok("empat terkirim, satu dilewati", status.sent === 4 && status.skipped === 1, JSON.stringify(status));

  const { rows } = await adminPool.query<{ status: string; skip_reason: string | null }>(
    "SELECT status::text, skip_reason FROM campaign_recipients WHERE email = $1",
    ["c2@uji.id"],
  );
  ok("alamat tersuppress bertanda skipped, dengan alasan", rows[0]?.status === "skipped" && Boolean(rows[0]?.skip_reason), rows[0]?.skip_reason ?? "");

  const terpakai = await terpakaiHariIni();
  ok("kuota hanya terpakai untuk yang benar-benar dikirim", terpakai === 4, `${terpakai}`);

  const setelah = await kampanye.get(c.id);
  ok("kampanye selesai karena tidak ada queued", setelah?.status === "selesai", String(setelah?.status));
}

/**
 * CATATAN JUJUR TENTANG CAKUPAN.
 *
 * Uji ini membuktikan batch berhenti tepat di sisa kuota dan tidak ada baris
 * yang hilang. Ia TIDAK mereproduksi kasus yang sesungguhnya berbahaya:
 * kuota habis di tengah batch karena ada worker LAIN yang ikut mengirim di
 * sela transaksi. Kasus itu butuh dua proses saling menyela dan tidak dapat
 * dipicu secara deterministik dari satu proses uji.
 *
 * Yang melindungi dari kasus itu adalah SAVEPOINT per penerima di
 * `send-worker.ts` — tanpa itu, rollback batch mengembalikan baris yang sudah
 * terkirim menjadi `queued` dan pesannya dikirim ulang. Perlindungan itu ada
 * di kode, bukan dibuktikan uji ini.
 */
async function ujiKuotaHabisDiTengahBatch() {
  bagian("send-worker — batch berhenti tepat di sisa kuota");

  await bersihkan();
  await setTahap(3); // batas 500 → jatah = BATCH = 50
  await buatKontak(10, "d");

  const c = await buatKampanye("Uji kuota tengah batch");
  await kampanye.susunAntrean(c.id);
  await kampanye.ubahStatus(c.id, "terjadwal");

  // Sisakan hanya 3 slot: 500 - 497. Batch mengambil 50 baris, jadi kuota
  // pasti habis di tengah — persis keadaan yang terjadi kalau ada proses lain
  // ikut mengirim di sela.
  await adminPool.query(
    `INSERT INTO domain_daily_sends (domain, send_date, sent_count, tenant_id)
     VALUES ($1, CURRENT_DATE, 497, $2)
     ON CONFLICT (domain, send_date) DO UPDATE SET sent_count = 497`,
    [DOMAIN, TENANT],
  );

  await runSendWorker();

  const status = await hitungStatus(c.id);
  const terkirim = status.sent ?? 0;
  const terpakai = await terpakaiHariIni();

  ok(
    "pesan yang sudah keluar TERCATAT sebagai sent, tidak dibatalkan rollback",
    terkirim === 3,
    `sent=${terkirim} queued=${status.queued ?? 0}`,
  );
  ok(
    "penghitung kuota cocok dengan jumlah yang tercatat terkirim",
    terpakai === 497 + terkirim,
    `terpakai=${terpakai}, harapan=${497 + terkirim}`,
  );
  ok(
    "sisanya tetap queued untuk hari berikutnya",
    (status.queued ?? 0) === 10 - terkirim,
    JSON.stringify(status),
  );
  ok("tidak ada baris failed akibat kuota habis", (status.failed ?? 0) === 0, JSON.stringify(status));
}

async function ujiHakPeranAplikasi() {
  bagian("Hak peran aplikasi pada tabel baru");

  if (config.db.usingAdminForApp) {
    ok("APP_DATABASE_URL terpasang", false, "peran aplikasi tidak diuji — masih memakai pemilik");
    return;
  }

  const app = new pg.Client({ connectionString: config.db.appUrl });
  await app.connect();
  try {
    for (const t of ["campaigns", "campaign_recipients", "domain_health", "domain_daily_sends"]) {
      try {
        await app.query(`SELECT 1 FROM ${t} LIMIT 1`);
        ok(`peran aplikasi dapat membaca ${t}`, true);
      } catch (e) {
        ok(`peran aplikasi dapat membaca ${t}`, false, (e as Error).message);
      }
    }

    // Yang harus TETAP tertutup meski tabel baru ditambahkan.
    try {
      await app.query("DELETE FROM suppression");
      ok("DELETE suppression tetap ditolak setelah migrasi baru", false, "penghapusan BERHASIL");
    } catch (e) {
      ok(
        "DELETE suppression tetap ditolak setelah migrasi baru",
        (e as { code?: string }).code === "42501",
        `SQLSTATE ${(e as { code?: string }).code}`,
      );
    }
  } finally {
    await app.end();
  }
}

async function ujiKuotaTerpakaiTidakMundur() {
  bagian("Kuota — pakaiKuota menolak melewati batas");

  await bersihkan();
  await setTahap(1); // 50

  const sebelum = await kuotaHariIni(DOMAIN);
  ok("sisa awal 50", sebelum.sisa === 50, `${sebelum.sisa}`);

  const muat = await transaction((tx) => pakaiKuota(tx, DOMAIN, 50));
  ok("mengambil tepat 50 diizinkan", muat === true);

  const lagi = await transaction((tx) => pakaiKuota(tx, DOMAIN, 1));
  ok("satu lagi setelah batas ditolak", lagi === false);

  const akhir = await kuotaHariIni(DOMAIN);
  ok("sisa menjadi 0, tidak negatif", akhir.sisa === 0, `${akhir.sisa}`);
}


/**
 * Regresi temuan keamanan: berhenti berlangganan yang gagal diam-diam.
 *
 * Membatalkan batch impor menghapus kontak, tapi baris `campaign_recipients`
 * bertahan (`ON DELETE SET NULL`) dan tetap dikirimi. Dulu penerima yang
 * mengklik "berhenti berlangganan" pada pesan itu mendapat halaman BERHASIL
 * tanpa satu baris pun masuk daftar penekanan.
 */
async function ujiBerhentiSetelahKontakDihapus() {
  bagian("Berhenti berlangganan tetap bekerja setelah kontaknya dihapus");

  await bersihkan();
  await setTahap(3);
  await buatKontak(2, "e");

  const c = await buatKampanye("Uji berhenti");
  await kampanye.susunAntrean(c.id);

  const { rows: sebelum } = await adminPool.query<{ id: string; contact_id: string; email: string }>(
    "SELECT id, contact_id, email::text AS email FROM campaign_recipients WHERE email = $1",
    ["e0@uji.id"],
  );
  const barisPenerima = sebelum[0];
  const kontakId = barisPenerima.contact_id;

  // Kontak dihapus — persis yang dilakukan pembatalan batch impor.
  await adminPool.query("DELETE FROM contacts WHERE id = $1", [kontakId]);

  const { rows: sesudah } = await adminPool.query<{ contact_id: string | null }>(
    "SELECT contact_id FROM campaign_recipients WHERE id = $1",
    [barisPenerima.id],
  );
  ok(
    "baris penerima bertahan dengan contact_id NULL",
    sesudah[0]?.contact_id === null,
    String(sesudah[0]?.contact_id),
  );

  // Token yang dicetak atas id KONTAK yang sudah dihapus.
  const tokenKontak = createUnsubscribeToken(kontakId);
  ok("token lama masih terverifikasi", verifyUnsubscribeToken(tokenKontak) === kontakId);

  // Token gaya LAMA (atas id kontak) memang tidak dapat diselesaikan setelah
  // kontaknya dihapus — jejaknya hilang bersama `ON DELETE SET NULL`. Yang
  // penting: ia GAGAL, bukan berpura-pura berhasil.
  const gayaLama = await suppressByUnsubscribeId(kontakId, "unsubscribe");
  ok("token atas kontak yang sudah dihapus ditolak, bukan sukses palsu", gayaLama === null);

  // Token gaya BARU: dicetak atas id baris penerima, yang bertahan.
  const hasil = await suppressByUnsubscribeId(barisPenerima.id, "unsubscribe");
  ok(
    "token atas id baris penerima menekan alamat yang benar",
    hasil?.email === "e0@uji.id",
    String(hasil?.email),
  );

  const { rows: tekan } = await adminPool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM suppression WHERE email = $1",
    ["e0@uji.id"],
  );
  ok("alamat benar-benar masuk daftar penekanan", Number(tekan[0].n) === 1, `${tekan[0].n} baris`);

  // Pengenal yang tidak menunjuk apa pun harus GAGAL, bukan berpura-pura sukses.
  const kosong = await suppressByUnsubscribeId(
    "00000000-0000-4000-8000-000000000000",
    "unsubscribe",
  );
  ok("pengenal tak dikenal tidak menghasilkan sukses palsu", kosong === null);

  // Kampanye berikutnya tidak boleh menyentuh alamat itu lagi.
  await kampanye.ubahStatus(c.id, "terjadwal");
  await runSendWorker();
  const { rows: akhir } = await adminPool.query<{ status: string }>(
    "SELECT status::text FROM campaign_recipients WHERE email = $1",
    ["e0@uji.id"],
  );
  ok(
    "penerima yang berhenti dilewati saat pengiriman",
    akhir[0]?.status === "skipped",
    String(akhir[0]?.status),
  );
}


/**
 * Aktivasi manual kontak karantina.
 *
 * Yang diuji di sini bukan "tombolnya jalan", melainkan tiga penolakan yang
 * membuat tombol itu aman: kontak diblokir tidak dapat dibangkitkan, alamat
 * yang sudah ditekan tidak dapat dihidupkan lagi, dan alamat tebakan tidak
 * ikut terbawa tanpa diminta.
 */
async function ujiAktivasiKontak() {
  bagian("Aktivasi manual — tiga penolakan yang menjaganya");

  await bersihkan();

  const pasang = async (
    email: string,
    status: string,
    origin: string,
  ): Promise<string> => {
    const { rows } = await adminPool.query<{ id: string }>(
      `INSERT INTO contacts (email, domain, company_name, consent_source,
                             consent_strength, email_origin, status, tenant_id)
       VALUES ($1, 'uji.id', 'PT Uji', 'formulir_web', 'kuat', $2::email_origin,
               $3::contact_status, $4)
       RETURNING id`,
      [email, origin, status, TENANT],
    );
    return rows[0].id;
  };

  const found = await pasang("f@uji.id", "karantina", "found");
  const tebakan = await pasang("g@uji.id", "karantina", "guessed");
  const diblokir = await pasang("b@uji.id", "diblokir", "found");
  const sudahAktif = await pasang("a@uji.id", "aktif", "found");
  const tertekan = await pasang("s@uji.id", "karantina", "found");
  await adminPool.query(
    "INSERT INTO suppression (email, reason, tenant_id) VALUES ($1, 'unsubscribe', $2)",
    ["s@uji.id", TENANT],
  );
  const hantu = "00000000-0000-4000-8000-000000000000";

  const semua = [found, tebakan, diblokir, sudahAktif, tertekan, hantu];
  const hasil = await aktifkanKontak({ ids: semua, dinyatakanOleh: "Lathif" });

  ok("hanya alamat found yang diaktifkan", hasil.diaktifkan === 1, `${hasil.diaktifkan} diaktifkan`);
  ok("alamat tebakan ditolak secara bawaan", hasil.ringkasan.alamat_tebakan === 1);
  ok("kontak diblokir TIDAK dapat dibangkitkan", hasil.ringkasan.diblokir === 1);
  ok("alamat di daftar penekanan ditolak", hasil.ringkasan.ada_di_penekanan === 1);
  ok("kontak yang sudah aktif dilewati", hasil.ringkasan.sudah_aktif === 1);
  ok("id tak dikenal dilaporkan, bukan didiamkan", hasil.ringkasan.tidak_ditemukan === 1);

  const cek = async (id: string) => {
    const { rows } = await adminPool.query<{ status: string; by: string | null }>(
      "SELECT status::text AS status, activated_by AS by FROM contacts WHERE id = $1",
      [id],
    );
    return rows[0];
  };

  ok("kontak diblokir tetap diblokir di basis data", (await cek(diblokir)).status === "diblokir");
  ok("alamat tertekan tetap karantina", (await cek(tertekan)).status === "karantina");
  ok("alamat tebakan tetap karantina", (await cek(tebakan)).status === "karantina");

  const aktifBaru = await cek(found);
  ok("kontak yang diaktifkan tercatat siapa pelakunya", aktifBaru.by === "Lathif", String(aktifBaru.by));

  // Pengecualian eksplisit: alamat tebakan boleh, tapi penolakan lain TETAP.
  const paksa = await aktifkanKontak({
    ids: [tebakan, diblokir, tertekan],
    dinyatakanOleh: "Lathif",
    izinkanTebakan: true,
  });
  ok("dengan izin eksplisit, alamat tebakan aktif", paksa.diaktifkan === 1, `${paksa.diaktifkan}`);
  ok("izin tebakan TIDAK melonggarkan aturan diblokir", paksa.ringkasan.diblokir === 1);
  ok("izin tebakan TIDAK melonggarkan aturan penekanan", paksa.ringkasan.ada_di_penekanan === 1);

  // Dapat dibatalkan.
  const balik = await karantinakanKontak([found, tebakan]);
  ok("aktivasi dapat dikembalikan ke karantina", balik.dikarantina === 2, `${balik.dikarantina}`);
  ok("jejak aktivasi ikut dibersihkan", (await cek(found)).by === null);

  const balikDiblokir = await karantinakanKontak([diblokir]);
  ok("mengarantinakan kontak diblokir tidak mengubah apa pun", balikDiblokir.dikarantina === 0);
  ok("kontak diblokir tetap diblokir", (await cek(diblokir)).status === "diblokir");
}


/**
 * Pemilihan penerima satu per satu.
 *
 * Inti yang diuji: yang benar-benar diantrekan harus SAMA PERSIS dengan yang
 * dihitung pra-kirim. Dua angka itu dulu dihasilkan dua potongan SQL terpisah;
 * kalau berbeda, keputusan boleh-tidaknya mengirim dibuat atas angka yang salah.
 */
async function ujiPilihPenerima() {
  bagian("Memilih penerima satu per satu");

  await bersihkan();
  await setTahap(1); // 50/hari
  await buatKontak(60, "p");

  const { rows: semua } = await adminPool.query<{ id: string }>(
    "SELECT id FROM contacts ORDER BY email LIMIT 12",
  );
  const dipilih = semua.slice(0, 12).map((r) => r.id);

  const c = await kampanye.create({
    name: "Uji pilih penerima",
    subject: "Halo {{nama_perusahaan}}",
    bodyText: "Isi.",
    bodyHtml: null,
    senderDomain: DOMAIN,
    segmentFilter: { contact_ids: dipilih },
  });

  const cek = await preflight(c.id);
  ok(
    "pra-kirim menghitung hanya yang dipilih",
    cek.ringkasan.layak_kirim === 12,
    `${cek.ringkasan.layak_kirim} layak`,
  );
  ok("12 penerima muat dalam kuota 50, jadi lolos", cek.dapat_dikirim === true);

  const antre = await kampanye.susunAntrean(c.id);
  ok("yang diantrekan sama dengan yang dihitung pra-kirim", antre.diantrekan === 12, `${antre.diantrekan}`);

  const { rows: hasil } = await adminPool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM campaign_recipients WHERE campaign_id = $1",
    [c.id],
  );
  ok("tidak ada kontak lain yang ikut terbawa", Number(hasil[0].n) === 12, `${hasil[0].n} baris`);

  // Daftar kosong: yang paling berbahaya kalau salah tafsir.
  const kosong = await kampanye.create({
    name: "Uji pilihan kosong",
    subject: "Halo",
    bodyText: "Isi.",
    bodyHtml: null,
    senderDomain: DOMAIN,
    segmentFilter: { contact_ids: [] },
  });
  const antreKosong = await kampanye.susunAntrean(kosong.id);
  ok(
    "pilihan kosong TIDAK berubah menjadi kirim ke semua",
    antreKosong.diantrekan === 0,
    `${antreKosong.diantrekan} diantrekan`,
  );

  // Melebihi kuota tetap ditahan meski dipilih manual.
  const banyak = await adminPool.query<{ id: string }>("SELECT id FROM contacts");
  const semuaId = banyak.rows.map((r) => r.id);
  const berlebih = await kampanye.create({
    name: "Uji pilih melebihi kuota",
    subject: "Halo",
    bodyText: "Isi.",
    bodyHtml: null,
    senderDomain: DOMAIN,
    segmentFilter: { contact_ids: semuaId },
  });
  const cekBerlebih = await preflight(berlebih.id);
  ok(
    "memilih 60 saat kuota 50 tetap ditahan pra-kirim",
    cekBerlebih.dapat_dikirim === false,
    `layak=${cekBerlebih.ringkasan.layak_kirim} sisa=${cekBerlebih.ringkasan.sisa_kuota}`,
  );

  // Kontak karantina tidak ikut walau dipilih eksplisit.
  await adminPool.query("UPDATE contacts SET status = 'karantina' WHERE id = ANY($1::uuid[])", [
    dipilih.slice(0, 5),
  ]);
  const c2 = await kampanye.create({
    name: "Uji pilih termasuk karantina",
    subject: "Halo",
    bodyText: "Isi.",
    bodyHtml: null,
    senderDomain: DOMAIN,
    segmentFilter: { contact_ids: dipilih },
  });
  const antre2 = await kampanye.susunAntrean(c2.id);
  ok(
    "kontak karantina tidak ikut meski dipilih eksplisit",
    antre2.diantrekan === 7,
    `${antre2.diantrekan} dari 12 dipilih`,
  );
}


/**
 * /domain/health harus memakai penghitung kuota yang SAMA dengan pra-kirim.
 *
 * Dulu rute itu menuliskan `sent_today = 0` secara tetap, jadi panel melaporkan
 * sisa kuota penuh sementara pra-kirim menahan pengiriman. Dua angka untuk hal
 * yang sama, dan yang dilihat pengguna justru yang salah.
 */
async function ujiKuotaSatuSumber() {
  bagian("Kesehatan domain memakai penghitung kuota yang sama dengan pra-kirim");

  await bersihkan();
  await setTahap(1); // batas 50

  await adminPool.query(
    `INSERT INTO domain_daily_sends (domain, send_date, sent_count, tenant_id)
     VALUES ($1, CURRENT_DATE, 48, $2)
     ON CONFLICT (domain, send_date) DO UPDATE SET sent_count = 48`,
    [DOMAIN, TENANT],
  );

  const kuota = await kuotaHariIni(DOMAIN);
  ok("penghitung membaca 48 terpakai", kuota.terpakaiHariIni === 48, `${kuota.terpakaiHariIni}`);
  ok("sisa kuota 2, bukan 50", kuota.sisa === 2, `${kuota.sisa}`);

  await buatKontak(5, "q");
  const { rows } = await adminPool.query<{ id: string }>("SELECT id FROM contacts LIMIT 5");
  const c = await kampanye.create({
    name: "Uji kuota satu sumber",
    subject: "Halo",
    bodyText: "Isi.",
    bodyHtml: null,
    senderDomain: DOMAIN,
    segmentFilter: { contact_ids: rows.map((r) => r.id) },
  });

  const cek = await preflight(c.id);
  ok(
    "pra-kirim memakai sisa yang sama, bukan batas penuh",
    cek.ringkasan.sisa_kuota === 2,
    `${cek.ringkasan.sisa_kuota}`,
  );
  ok("memilih 5 saat sisa 2 ditahan", cek.dapat_dikirim === false);
}

async function ujiTindakLanjut() {
  bagian("Tindak lanjut — hanya yang bereaksi yang terdaftar");

  await bersihkan();
  await setTahap(5); // tanpa batas harian, supaya kuota tidak ikut mengaburkan
  await buatKontak(3, "t");

  const induk = await buatKampanye("Perkenalan");
  await kampanye.susunAntrean(induk.id);
  await runSendWorker();

  const { rows: terkirim } = await adminPool.query<{
    id: string;
    email: string;
    message_id: string;
    contact_id: string;
  }>(
    `SELECT id, email::text AS email, message_id, contact_id
       FROM campaign_recipients WHERE campaign_id = $1 ORDER BY email`,
    [induk.id],
  );
  ok("tiga pesan perkenalan terkirim", terkirim.length === 3, `${terkirim.length}`);

  // Satu membuka, satu membalas, satu diam.
  await kampanye.catatEvent(terkirim[0].message_id, "open");
  const tertaut = await kampanye.catatBalasan({
    email: terkirim[1].email,
    cuplikan: "Boleh dikirimi profil perusahaan?",
  });
  ok("balasan tertaut ke kampanye yang benar", tertaut?.campaign_id === induk.id);

  const ringkas = await kampanye.ringkasanTindakLanjut(induk.id, JENDELA_DIAM_HARI);
  ok("dua penerima terhitung bereaksi", ringkas.bereaksi === 2, `${ringkas.bereaksi}`);
  ok("satu di antaranya membalas", ringkas.membalas === 1, `${ringkas.membalas}`);
  ok("yang belum bereaksi masih dihitung menunggu", ringkas.menunggu === 1, `${ringkas.menunggu}`);

  // ── Jeda menahan pendaftaran ───────────────────────────────────────────────
  const ditahan = await kampanye.create({
    name: "Lanjutan berjeda",
    subject: "Lanjutan untuk {{nama_perusahaan}}",
    bodyText: "Isi lanjutan.",
    bodyHtml: null,
    senderDomain: DOMAIN,
    parentCampaignId: induk.id,
    pemicu: "apa_saja",
    jedaLanjutanJam: 24,
    lanjutanAktif: true,
  });
  await runFollowupWorker();
  const isiDitahan = await hitungStatus(ditahan.id);
  ok(
    "reaksi yang baru terjadi belum masuk antrean lanjutan",
    Object.keys(isiDitahan).length === 0,
    JSON.stringify(isiDitahan),
  );

  // Pra-kirim harus melihat himpunan yang SAMA dengan yang diantrekan. Kalau
  // ia menghitung dari segment_filter mentah, angkanya menjadi seluruh basis
  // kontak dan kampanye lanjutan lolos dengan audiens yang salah.
  const cekDitahan = await preflight(ditahan.id);
  ok(
    "pra-kirim lanjutan memakai segmen efektif, bukan segmen mentah",
    cekDitahan.ringkasan.layak_kirim === 0,
    `${cekDitahan.ringkasan.layak_kirim}`,
  );

  // ── Tanpa jeda, yang bereaksi langsung terdaftar ───────────────────────────
  const langsung = await kampanye.create({
    name: "Lanjutan langsung",
    subject: "Lanjutan untuk {{nama_perusahaan}}",
    bodyText: "Isi lanjutan.",
    bodyHtml: null,
    senderDomain: DOMAIN,
    parentCampaignId: induk.id,
    pemicu: "apa_saja",
    jedaLanjutanJam: 0,
    lanjutanAktif: true,
  });
  await runFollowupWorker();
  const isiLangsung = await hitungStatus(langsung.id);
  ok("dua yang bereaksi masuk antrean lanjutan", isiLangsung.queued === 2, JSON.stringify(isiLangsung));

  // ── Pemicu yang lebih sempit menjaring lebih sedikit ───────────────────────
  const hanyaBalas = await kampanye.create({
    name: "Lanjutan khusus pembalas",
    subject: "Terima kasih, {{nama_perusahaan}}",
    bodyText: "Isi lanjutan.",
    bodyHtml: null,
    senderDomain: DOMAIN,
    parentCampaignId: induk.id,
    pemicu: "membalas",
    jedaLanjutanJam: 0,
    lanjutanAktif: true,
  });
  await runFollowupWorker();
  const isiBalas = await hitungStatus(hanyaBalas.id);
  ok("pemicu membalas hanya menjaring yang membalas", isiBalas.queued === 1, JSON.stringify(isiBalas));

  // ── Kampanye bergulir tidak ditutup saat antreannya kosong ─────────────────
  await runSendWorker();
  const setelahKirim = await kampanye.get(langsung.id);
  ok(
    "kampanye lanjutan bergulir tidak dinyatakan selesai",
    setelahKirim?.status !== "selesai",
    setelahKirim?.status ?? "-",
  );

  await kampanye.ubahLanjutanAktif(langsung.id, false);
  await runSendWorker();
  const setelahBerhenti = await kampanye.get(langsung.id);
  ok(
    "setelah pendaftaran dihentikan, kampanye boleh selesai",
    setelahBerhenti?.status === "selesai",
    setelahBerhenti?.status ?? "-",
  );
}

async function ujiPenilaianRespons() {
  bagian("Penilaian respons — yang diam berhenti dikirimi, penolakan menang");

  // Meneruskan keadaan dari uji sebelumnya bukan pilihan: fixture bersama
  // membuat kegagalan di satu uji memunculkan kegagalan palsu di uji lain.
  await bersihkan();
  await setTahap(5);
  await buatKontak(3, "r");

  const induk = await buatKampanye("Perkenalan untuk penilaian");
  await kampanye.susunAntrean(induk.id);
  await runSendWorker();

  const { rows } = await adminPool.query<{ id: string; email: string; message_id: string; contact_id: string }>(
    `SELECT id, email::text AS email, message_id, contact_id
       FROM campaign_recipients WHERE campaign_id = $1 ORDER BY email`,
    [induk.id],
  );

  await kampanye.catatEvent(rows[0].message_id, "click");
  await suppressByUnsubscribeId(rows[1].id, "unsubscribe");

  // Dinilai seolah sebulan telah lewat. Menggeser waktu di parameter, bukan di
  // basis data: yang diuji adalah aturannya, bukan kemampuan menulis tanggal.
  const nanti = new Date(Date.now() + (JENDELA_DIAM_HARI + 1) * 24 * 60 * 60 * 1000);
  await nilaiUlangRespons(1000, nanti);

  const { rows: nilai } = await adminPool.query<{ id: string; respons: string }>(
    "SELECT id, respons::text AS respons FROM contacts ORDER BY email",
  );
  const per = Object.fromEntries(nilai.map((n) => [n.id, n.respons]));

  ok("yang mengklik dinilai tertarik", per[rows[0].contact_id] === "tertarik", per[rows[0].contact_id]);
  ok("yang berhenti berlangganan dinilai menolak", per[rows[1].contact_id] === "menolak", per[rows[1].contact_id]);
  ok("yang tidak bereaksi sebulan dinilai diam", per[rows[2].contact_id] === "diam", per[rows[2].contact_id]);

  // ── Penghapusan retensi hanya menyentuh yang diam ──────────────────────────
  const semuaId = nilai.map((n) => n.id);
  const hasil = await hapusKontakDiam(semuaId, "uji regresi");
  ok("hanya kontak diam yang terhapus", hasil.dihapus === 1, `${hasil.dihapus} dari ${semuaId.length}`);

  const { rows: sisa } = await adminPool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM contacts",
  );
  ok("kontak tertarik dan menolak tetap ada", Number(sisa[0].n) === 2, sisa[0].n);

  // Barisnya di campaign_recipients harus bertahan: angka reputasi dihitung
  // dari sana, dan tautan berhenti berlangganan pada pesan yang sudah terkirim
  // harus tetap dapat dipenuhi setelah kontaknya hilang.
  const { rows: jejak } = await adminPool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM campaign_recipients WHERE campaign_id = $1",
    [induk.id],
  );
  ok("jejak pengiriman tidak ikut terhapus", Number(jejak[0].n) === 3, jejak[0].n);
}

async function ujiIsolasiTenant() {
  bagian("Isolasi pelanggan — ditegakkan basis data, bukan query");

  await bersihkan();
  await setTahap(5);
  await buatKontak(4, "iso");

  // Satu kontak milik pelanggan tetangga, disisipkan lewat koneksi pemilik.
  await adminPool.query(
    `INSERT INTO contacts (email, domain, company_name, consent_source,
                           consent_strength, email_origin, status, tenant_id)
     VALUES ('tetangga@lain.id', 'lain.id', 'PT Tetangga', 'formulir_web',
             'kuat', 'found', 'aktif', $1)`,
    [TENANT_LAIN],
  );

  // ── Pelanggan hanya melihat barisnya sendiri ───────────────────────────────
  const terlihat = await dalamKonteks({ tenantId: TENANT }, async () => {
    const { rows } = await query<{ n: string }>("SELECT count(*)::text AS n FROM contacts");
    return Number(rows[0].n);
  });
  ok("pelanggan hanya melihat kontaknya sendiri", terlihat === 4, `${terlihat} terlihat`);

  const terlihatLain = await dalamKonteks({ tenantId: TENANT_LAIN }, async () => {
    const { rows } = await query<{ n: string }>("SELECT count(*)::text AS n FROM contacts");
    return Number(rows[0].n);
  });
  ok("pelanggan tetangga melihat miliknya sendiri", terlihatLain === 1, `${terlihatLain} terlihat`);

  // ── Menyebut id milik pelanggan lain tetap tidak menghasilkan apa pun ──────
  //
  // Ini inti dari memakai RLS alih-alih `WHERE tenant_id`. Query di bawah
  // TIDAK menyaring apa pun — persis seperti query yang lupa menuliskan
  // penyaringnya — dan tetap tidak mengembalikan baris pelanggan lain.
  const bocor = await dalamKonteks({ tenantId: TENANT }, async () => {
    const { rows } = await query<{ email: string }>(
      "SELECT email::text AS email FROM contacts WHERE email = 'tetangga@lain.id'",
    );
    return rows.length;
  });
  ok("query tanpa penyaring pun tidak menembus pelanggan lain", bocor === 0, `${bocor} baris`);

  // ── UPDATE dan DELETE ikut tersaring ──────────────────────────────────────
  const diubah = await dalamKonteks({ tenantId: TENANT }, async () => {
    const { rowCount } = await query(
      "UPDATE contacts SET company_name = 'DIUBAH' WHERE email = 'tetangga@lain.id'",
    );
    return rowCount ?? 0;
  });
  ok("UPDATE tidak menyentuh baris pelanggan lain", diubah === 0);

  const dihapus = await dalamKonteks({ tenantId: TENANT }, async () => {
    const { rowCount } = await query(
      "DELETE FROM contacts WHERE email = 'tetangga@lain.id'",
    );
    return rowCount ?? 0;
  });
  ok("DELETE tidak menyentuh baris pelanggan lain", dihapus === 0);

  const { rows: masihAda } = await adminPool.query<{ company_name: string }>(
    "SELECT company_name FROM contacts WHERE email = 'tetangga@lain.id'",
  );
  ok(
    "baris pelanggan tetangga utuh, isinya tidak berubah",
    masihAda.length === 1 && masihAda[0].company_name === "PT Tetangga",
    masihAda[0]?.company_name ?? "hilang",
  );

  // ── INSERT mendapat pemiliknya dari konteks, bukan dari kolom ─────────────
  const milik = await dalamKonteks({ tenantId: TENANT_LAIN }, async () => {
    await query(
      `INSERT INTO contacts (email, domain, consent_source, consent_strength,
                             email_origin, status)
       VALUES ('baru@lain.id', 'lain.id', 'formulir_web', 'kuat', 'found', 'aktif')`,
    );
    const { rows } = await adminPool.query<{ tenant_id: string }>(
      "SELECT tenant_id FROM contacts WHERE email = 'baru@lain.id'",
    );
    return rows[0]?.tenant_id;
  });
  ok("INSERT tanpa menyebut tenant_id tetap bertuan", milik === TENANT_LAIN);

  // ── Alamat yang sama boleh dimiliki dua pelanggan ─────────────────────────
  //
  // Keunikan email menjadi (tenant_id, email). Kalau tetap global, pelanggan
  // kedua yang mengimpor alamat yang sudah dipakai pelanggan pertama akan
  // ditolak duplikat — dan pesan galatnya sendiri sudah membocorkan bahwa
  // alamat itu ada di sistem.
  let gandaBoleh = true;
  try {
    await dalamKonteks({ tenantId: TENANT_LAIN }, () =>
      query(
        `INSERT INTO contacts (email, domain, consent_source, consent_strength,
                               email_origin, status)
         VALUES ('iso0@uji.id', 'uji.id', 'formulir_web', 'kuat', 'found', 'aktif')`,
      ),
    );
  } catch {
    gandaBoleh = false;
  }
  ok("alamat yang sama boleh dimiliki dua pelanggan", gandaBoleh);

  // ── Tanpa konteks, tidak ada apa pun yang terbaca ────────────────────────
  //
  // Bukan "semua terbaca". Ini yang membuat lupa memasang konteks berakhir
  // sebagai kegagalan yang terlihat, bukan sebagai kebocoran senyap.
  let melempar = false;
  try {
    await query("SELECT 1 FROM contacts");
  } catch {
    melempar = true;
  }
  ok("query tanpa konteks ditolak, bukan dijawab apa adanya", melempar);

  const kosong = await dalamKonteks({ tenantId: null }, async () => {
    const { rows } = await query<{ n: string }>("SELECT count(*)::text AS n FROM contacts");
    return Number(rows[0].n);
  });
  ok("konteks tanpa pelanggan melihat nol baris", kosong === 0, `${kosong} terlihat`);

  // ── Superadmin melihat lintas pelanggan ──────────────────────────────────
  const semua = await dalamKonteks({ tenantId: null, superadmin: true }, async () => {
    const { rows } = await query<{ n: string }>("SELECT count(*)::text AS n FROM contacts");
    return Number(rows[0].n);
  });
  // 4 milik pelanggan uji + 3 milik tetangga (satu bawaan, satu disisipkan
  // lewat konteks, satu alamat kembar yang dibolehkan keunikan per pelanggan).
  ok("superadmin melihat seluruh pelanggan", semua === 7, `${semua} terlihat`);
}

async function ujiPembekuanDanAkun() {
  bagian("Pembekuan, sesi, dan kata sandi");

  await bersihkan();
  await setTahap(5);
  await buatKontak(3, "beku");

  // ── Kata sandi ────────────────────────────────────────────────────────────
  const hash = await hashSandi("sandi-yang-cukup-panjang");
  ok("hash tidak memuat sandinya", !hash.includes("sandi-yang-cukup-panjang"));
  ok("sandi benar cocok", await sandiCocok("sandi-yang-cukup-panjang", hash));
  ok("sandi salah tidak cocok", !(await sandiCocok("sandi-yang-salah-sekali", hash)));
  ok("hash rusak ditolak, bukan melempar", !(await sandiCocok("apa pun", "bukan-hash")));

  // ── Sesi ──────────────────────────────────────────────────────────────────
  const admin = await buatPengguna({
    tenantId: TENANT,
    email: "admin@regresi.uji",
    nama: "Admin Regresi",
    peran: "admin",
    sandi: "sandi-admin-regresi",
  });

  ok(
    "kredensial benar diterima",
    (await verifikasiKredensial("admin@regresi.uji", "sandi-admin-regresi"))?.id === admin.id,
  );
  ok(
    "kredensial salah ditolak",
    (await verifikasiKredensial("admin@regresi.uji", "sandi-yang-lain")) === null,
  );

  const sesi = await buatSesi(admin.id);
  const dibaca = await bacaSesi(sesi.token);
  ok("sesi terbaca beserta penggunanya", dibaca?.pengguna.id === admin.id);
  ok("token acak tidak membuka sesi", (await bacaSesi("token-karangan")) === null);

  // ── Pembekuan mencabut sesi seketika ─────────────────────────────────────
  const beku = await tenantRepo.bekukan(TENANT, "uji regresi", "regresi@uji.id");
  ok("pembekuan mencatat alasannya", beku.tenant?.alasan_beku === "uji regresi");
  ok("pembekuan mencabut sesi", beku.sesi_dicabut === 1, `${beku.sesi_dicabut} dicabut`);
  ok("sesi yang dicabut tidak lagi terbaca", (await bacaSesi(sesi.token)) === null);

  // ── Pelanggan yang dibekukan tidak boleh mengirim ────────────────────────
  const izin = await tenantRepo.bolehMengirim(TENANT);
  ok("pelanggan dibekukan tidak boleh mengirim", izin.boleh === false, izin.status);

  const c = await buatKampanye("Kampanye saat dibekukan");
  const cek = await preflight(c.id);
  const butir = cek.pemeriksaan.find((b) => b.butir === "pelanggan_aktif");
  ok("pra-kirim memblokir kampanye pelanggan yang dibekukan", cek.dapat_dikirim === false);
  ok("butir pelanggan_aktif gagal dengan alasannya", butir?.lolos === false, butir?.pesan ?? "");

  // Pekerjaan latar melewatinya juga — daftar pelanggan aktif tidak memuatnya.
  const aktif = await tenantRepo.tenantAktif();
  ok(
    "worker tidak menjadwalkan pelanggan yang dibekukan",
    !aktif.some((t) => t.id === TENANT),
    `${aktif.length} pelanggan aktif`,
  );
  const hidup = await tenantRepo.tenantHidup();
  ok(
    "penilaian respons tetap mencakupnya",
    hidup.some((t) => t.id === TENANT),
  );

  // ── Diaktifkan kembali ───────────────────────────────────────────────────
  const lagi = await tenantRepo.ubahStatus(TENANT, "aktif");
  ok("aktivasi membersihkan alasan pembekuan", lagi.tenant?.alasan_beku === null);
  const cek2 = await preflight(c.id);
  ok(
    "pra-kirim tidak lagi memblokir setelah diaktifkan",
    cek2.pemeriksaan.find((b) => b.butir === "pelanggan_aktif")?.lolos === true,
  );

  // ── Kuota kontak ─────────────────────────────────────────────────────────
  await tenantRepo.ubah(TENANT, { kuotaKontak: 5 });
  const sisa = await tenantRepo.sisaKuotaKontak(TENANT);
  ok("sisa kuota kontak dihitung dari yang sudah ada", sisa === 2, `sisa ${sisa}`);

  await tenantRepo.ubah(TENANT, { kuotaKontak: null });
  ok("kuota null berarti tanpa batas", (await tenantRepo.sisaKuotaKontak(TENANT)) === null);
}

async function main() {
  pastikanBasisDataUji(config.db.adminUrl);
  console.log(`Basis data uji : ${new URL(config.db.adminUrl).pathname.slice(1)}`);
  console.log(`Domain uji     : ${DOMAIN}`);
  console.log(`Driver email   : ${config.mail.driver}`);
  if (config.mail.driver !== "dummy") {
    console.error(
      "\nBERHENTI: MAIL_DRIVER bukan `dummy`. Uji ini mengirim ribuan pesan " +
        "ke alamat karangan — menjalankannya dengan driver sungguhan akan " +
        "merusak reputasi domain.",
    );
    process.exit(1);
  }

  await siapkanTenant();

  // Setiap bagian berjalan di dalam konteks pelanggan uji. Yang TIDAK
  // dibungkus adalah dua bagian terakhir: keduanya justru menguji perilaku
  // lintas pelanggan, jadi mereka mengatur konteksnya sendiri.
  await sebagaiTenant(ujiKuotaDanPreflight);
  await sebagaiTenant(ujiPengirimanBerhentiDiKuota);
  await sebagaiTenant(ujiPenekananSetelahAntre);
  await sebagaiTenant(ujiKuotaHabisDiTengahBatch);
  await sebagaiTenant(ujiKuotaTerpakaiTidakMundur);
  await sebagaiTenant(ujiBerhentiSetelahKontakDihapus);
  await sebagaiTenant(ujiAktivasiKontak);
  await sebagaiTenant(ujiPilihPenerima);
  await sebagaiTenant(ujiKuotaSatuSumber);
  await sebagaiTenant(ujiTindakLanjut);
  await sebagaiTenant(ujiPenilaianRespons);
  await sebagaiTenant(ujiHakPeranAplikasi);
  await ujiIsolasiTenant();
  await sebagaiTenant(ujiPembekuanDanAkun);

  await bersihkan();
  await pool.end();
  await adminPool.end();

  console.log(`\n${jumlah - gagal}/${jumlah} lulus`);
  process.exit(gagal === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\nuji regresi berhenti karena galat:", err);
  await pool.end().catch(() => {});
  await adminPool.end().catch(() => {});
  process.exit(1);
});
