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

import pg from "pg";
import { adminPool, pool, transaction } from "../db.js";
import { config } from "../config.js";
import * as kampanye from "../campaign/repo.js";
import { preflight } from "../campaign/preflight.js";
import { kuotaHariIni, pakaiKuota } from "../domain/quota.js";
import { runSendWorker } from "../jobs/send-worker.js";
import { tanggalMuat } from "../domain/warmup.js";
import { suppressByUnsubscribeId } from "../suppression/repo.js";
import { createUnsubscribeToken, verifyUnsubscribeToken } from "../lib/tokens.js";

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
  await adminPool.query("DELETE FROM campaign_recipients");
  await adminPool.query("DELETE FROM campaigns");
  await adminPool.query("DELETE FROM contacts");
  await adminPool.query("DELETE FROM import_batches");
  await adminPool.query("DELETE FROM domain_daily_sends");
  await adminPool.query("DELETE FROM domain_health");
  await adminPool.query("DELETE FROM suppression");
}

async function buatKontak(jumlahKontak: number, prefix: string) {
  const nilai: string[] = [];
  const params: unknown[] = [];
  for (let i = 0; i < jumlahKontak; i += 1) {
    const n = params.length;
    params.push(`${prefix}${i}@uji.id`, "uji.id", `PT Uji ${i}`);
    nilai.push(
      `($${n + 1}, $${n + 2}, $${n + 3}, 'formulir_web', 'kuat', 'found', 'aktif')`,
    );
  }
  await adminPool.query(
    `INSERT INTO contacts (email, domain, company_name, consent_source,
                           consent_strength, email_origin, status)
     VALUES ${nilai.join(", ")}`,
    params,
  );
}

async function setTahap(stage: number) {
  await adminPool.query(
    `INSERT INTO domain_health (domain, warmup_stage) VALUES ($1, $2)
     ON CONFLICT (domain) DO UPDATE SET warmup_stage = $2`,
    [DOMAIN, stage],
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
  await adminPool.query("INSERT INTO suppression (email, reason) VALUES ($1, 'unsubscribe')", [
    "c2@uji.id",
  ]);

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
    `INSERT INTO domain_daily_sends (domain, send_date, sent_count)
     VALUES ($1, CURRENT_DATE, 497)
     ON CONFLICT (domain, send_date) DO UPDATE SET sent_count = 497`,
    [DOMAIN],
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

async function main() {
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

  await ujiKuotaDanPreflight();
  await ujiPengirimanBerhentiDiKuota();
  await ujiPenekananSetelahAntre();
  await ujiKuotaHabisDiTengahBatch();
  await ujiKuotaTerpakaiTidakMundur();
  await ujiBerhentiSetelahKontakDihapus();
  await ujiHakPeranAplikasi();

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
