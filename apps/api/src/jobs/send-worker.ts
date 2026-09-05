// Handler `send-worker`.
//
// Berjalan tiap menit, mengambil kampanye berstatus `terjadwal` atau
// `berjalan`, dan mengirim sebanyak yang masih diizinkan kuota harian.
//
// Dua penjagaan yang sengaja diulang di sini meski antrean sudah menyaringnya:
//
// 1. Penekanan diperiksa ulang tepat sebelum kirim. Jeda antara antrean
//    disusun dan pesan keluar bisa berhari-hari, dan seseorang bisa berhenti
//    berlangganan di sela itu. Memeriksa dua kali murah; mengirim ke orang
//    yang sudah menolak tidak.
//
// 2. Kuota diperiksa per pesan, bukan sekali di awal batch. Kalau ada proses
//    lain yang ikut mengirim, batas tetap ditegakkan.

import type { PoolClient } from "pg";
import { clientKonteks, query, transaction } from "../db.js";
import { kuotaHariIni, pakaiKuota } from "../domain/quota.js";
import { mailDriver } from "../mail/index.js";
import { createUnsubscribeToken } from "../lib/tokens.js";
import { susunPesan } from "../campaign/compose.js";
import { ambilBatch, ubahStatus } from "../campaign/repo.js";

/** Batas per putaran, supaya satu kampanye tidak memonopoli worker. */
const BATCH = 50;

interface KampanyeAktif {
  id: string;
  subject: string;
  body_text: string;
  body_html: string | null;
  sender_domain: string;
  /** Kampanye tindak lanjut yang masih mendaftarkan penerima baru. */
  lanjutan_aktif: boolean;
}

async function kampanyeAktif(client: PoolClient): Promise<KampanyeAktif[]> {
  const { rows } = await client.query<KampanyeAktif>(
    `SELECT id, subject, body_text, body_html, sender_domain, lanjutan_aktif
       FROM campaigns
      WHERE status IN ('terjadwal', 'berjalan')
        AND (scheduled_at IS NULL OR scheduled_at <= now())
      ORDER BY created_at`,
  );
  return rows;
}

async function dataKontak(
  client: PoolClient,
  contactId: string | null,
): Promise<{ nama_perusahaan: string | null } | null> {
  if (!contactId) return null;
  const { rows } = await client.query<{ company_name: string | null }>(
    "SELECT company_name FROM contacts WHERE id = $1",
    [contactId],
  );
  return rows[0] ? { nama_perusahaan: rows[0].company_name } : null;
}

async function masihBolehDikirim(client: PoolClient, email: string): Promise<boolean> {
  const { rows } = await client.query(
    "SELECT 1 FROM suppression WHERE email = $1",
    [email],
  );
  return rows.length === 0;
}

async function kirimSatu(
  client: PoolClient,
  kampanye: KampanyeAktif,
  penerima: { id: string; contact_id: string | null; email: string },
): Promise<"terkirim" | "dilewati" | "gagal"> {
  if (!(await masihBolehDikirim(client, penerima.email))) {
    await client.query(
      `UPDATE campaign_recipients
          SET status = 'skipped', skip_reason = 'tersuppress sebelum giliran kirim'
        WHERE id = $1`,
      [penerima.id],
    );
    return "dilewati";
  }

  const muat = await pakaiKuota(client, kampanye.sender_domain, 1);
  if (!muat) {
    // Kuota habis di tengah batch. Baris dibiarkan `queued` supaya diambil
    // lagi besok — bukan ditandai gagal, karena tidak ada yang salah.
    throw new KuotaHabis();
  }

  const kontak = await dataKontak(client, penerima.contact_id);
  const pesan = susunPesan({
    subject: kampanye.subject,
    bodyText: kampanye.body_text,
    bodyHtml: kampanye.body_html,
    data: { nama_perusahaan: kontak?.nama_perusahaan ?? null, email: penerima.email },
    // Token berhenti berlangganan dicetak atas id BARIS PENERIMA, bukan atas
    // `contact_id`.
    //
    // `campaign_recipients.contact_id` di-NULL-kan begitu kontaknya dihapus
    // (`ON DELETE SET NULL`), sehingga token yang dicetak atasnya menjadi
    // tidak dapat ditelusuri ke alamat mana pun — sementara barisnya sendiri
    // tetap ada, tetap dikirimi, dan tetap menyimpan `email`.
    //
    // Id baris penerima tidak pernah berubah dan alamatnya `NOT NULL`, jadi
    // tautan berhenti berlangganan di pesan yang sudah terkirim tetap dapat
    // dipenuhi bertahun-tahun kemudian — yang memang syaratnya.
    contactId: penerima.id,
  });

  const driver = mailDriver();
  try {
    const hasil = await driver.send({
      to: penerima.email,
      subject: pesan.subject,
      textBody: pesan.textBody,
      htmlBody: pesan.htmlBody,
      unsubscribeToken: createUnsubscribeToken(penerima.id),
      campaignId: kampanye.id,
    });

    await client.query(
      `UPDATE campaign_recipients
          SET status = 'sent', sent_at = now(), message_id = $2, last_error = NULL
        WHERE id = $1`,
      [penerima.id, hasil.messageId],
    );
    return "terkirim";
  } catch (err) {
    await client.query(
      `UPDATE campaign_recipients
          SET status = 'failed', last_error = $2
        WHERE id = $1`,
      [penerima.id, err instanceof Error ? err.message : String(err)],
    );
    return "gagal";
  }
}

class KuotaHabis extends Error {
  constructor() {
    super("kuota harian habis");
    this.name = "KuotaHabis";
  }
}

export async function runSendWorker(): Promise<void> {
  const kampanyeList = await kampanyeAktif(await clientKonteks());

  if (kampanyeList.length === 0) return;

  const driver = mailDriver();
  if (!driver.sendsRealEmail) {
    console.info(
      `[send-worker] driver "${driver.name}" tidak mengirim ke internet — ` +
        "pesan hanya dicatat",
    );
  }

  for (const kampanye of kampanyeList) {
    const kuota = await kuotaHariIni(kampanye.sender_domain);
    if (kuota.sisa !== null && kuota.sisa <= 0) {
      console.info(
        `[send-worker] ${kampanye.id}: kuota harian habis (tahap ${kuota.stage}), ` +
          "dilanjutkan besok",
      );
      continue;
    }

    const jatah = kuota.sisa === null ? BATCH : Math.min(BATCH, kuota.sisa);
    let terkirim = 0;
    let dilewati = 0;
    let habis = false;

    try {
      await transaction(async (tx) => {
        const batch = await ambilBatch(tx, kampanye.id, jatah);
        if (batch.length === 0) return;

        await tx.query(
          "UPDATE campaigns SET status = 'berjalan', started_at = COALESCE(started_at, now()) WHERE id = $1 AND status = 'terjadwal'",
          [kampanye.id],
        );

        // Setiap penerima dibungkus SAVEPOINT.
        //
        // Sebelumnya kegagalan satu penerima membatalkan SELURUH transaksi
        // batch. Itu mengembalikan baris yang sudah `sent` menjadi `queued` —
        // padahal emailnya sudah benar-benar keluar dan tidak bisa ditarik.
        // Putaran berikutnya akan mengirimkannya lagi.
        //
        // Kirim ganda bukan sekadar boros: penerima yang sama menerima pesan
        // berulang adalah pemicu keluhan spam paling langsung, dan keluhan
        // itulah yang merusak reputasi domain — hal yang justru dijaga
        // seluruh produk ini.
        //
        // SAVEPOINT membatalkan hanya penerima yang gagal. Kunci baris dan
        // `FOR UPDATE` pada domain_health tetap dipegang transaksi luar, jadi
        // penjagaan terhadap pengambilan ganda antar-worker tidak berubah.
        for (const penerima of batch) {
          await tx.query("SAVEPOINT kirim_satu");
          try {
            const hasil = await kirimSatu(tx, kampanye, penerima);
            await tx.query("RELEASE SAVEPOINT kirim_satu");
            if (hasil === "terkirim") terkirim += 1;
            if (hasil === "dilewati") dilewati += 1;
          } catch (err) {
            // Mengembalikan transaksi ke keadaan sebelum penerima ini —
            // termasuk kenaikan penghitung kuota yang sudah terlanjur naik
            // di `pakaiKuota`.
            await tx.query("ROLLBACK TO SAVEPOINT kirim_satu");
            if (err instanceof KuotaHabis) {
              habis = true;
              break;
            }
            throw err;
          }
        }
      });
    } catch (err) {
      if (err instanceof KuotaHabis) {
        habis = true;
      } else {
        throw err;
      }
    }

    // Kampanye dinyatakan selesai hanya kalau tidak ada lagi baris `queued`.
    //
    // Kampanye tindak lanjut yang pendaftarannya masih bergulir dikecualikan.
    // Antreannya memang kosong hampir sepanjang waktu — penerima baru masuk
    // hanya saat ada yang bereaksi. Menyatakannya `selesai` pada saat itu
    // akan menutup pendaftaran selamanya, karena `susunAntrean` menolak
    // kampanye berstatus `selesai`: satu balasan yang datang sejam kemudian
    // tidak akan pernah ditindaklanjuti.
    const { rows } = await query<{ sisa: string }>(
      "SELECT count(*)::text AS sisa FROM campaign_recipients WHERE campaign_id = $1 AND status = 'queued'",
      [kampanye.id],
    );
    if (Number(rows[0].sisa) === 0 && !kampanye.lanjutan_aktif) {
      await ubahStatus(kampanye.id, "selesai");
    }

    console.info(
      `[send-worker] ${kampanye.id}: ${terkirim} terkirim, ${dilewati} dilewati` +
        (habis ? ", kuota habis di tengah batch" : ""),
    );
  }
}
