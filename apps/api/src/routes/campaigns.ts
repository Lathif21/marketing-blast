// Rute kampanye.
//
// `POST /campaigns/:id/send` menjalankan preflight lagi di sisi server sebelum
// menyusun antrean. Preflight yang hanya dipanggil UI bisa dilewati dengan
// memanggil endpoint kirim secara langsung — pemeriksaan yang menegakkan
// aturan harus berada di jalur yang sama dengan aksinya.

import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import * as repo from "../campaign/repo.js";
import { preflight } from "../campaign/preflight.js";
import { JEDA_BAWAAN_JAM, LABEL_PEMICU, PEMICU, pemicuSah } from "../campaign/followup.js";
import { JENDELA_DIAM_HARI } from "../campaign/engagement.js";

interface BodyBuat {
  name?: string;
  subject?: string;
  body_text?: string;
  body_html?: string | null;
  sender_domain?: string;
  segment_filter?: Record<string, unknown>;
}

export async function campaignRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { page?: string; per_page?: string } }>(
    "/campaigns",
    async (req) => {
      const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
      const perPage = Math.min(Math.max(Number(req.query.per_page ?? 20) || 20, 1), 100);
      return repo.list(page, perPage);
    },
  );

  app.post<{ Body: BodyBuat }>("/campaigns", async (req, reply) => {
    const { name, subject, body_text } = req.body ?? {};
    if (!name || !subject || !body_text) {
      return reply.code(400).send({
        pesan: "name, subject, dan body_text wajib diisi",
      });
    }
    const campaign = await repo.create({
      name,
      subject,
      bodyText: body_text,
      bodyHtml: req.body.body_html ?? null,
      senderDomain: req.body.sender_domain ?? config.sender.domain,
      segmentFilter: req.body.segment_filter ?? {},
    });
    return reply.code(201).send(campaign);
  });

  app.get<{ Params: { id: string } }>("/campaigns/:id", async (req, reply) => {
    const campaign = await repo.get(req.params.id);
    if (!campaign) return reply.code(404).send({ pesan: "kampanye tidak ditemukan" });
    return campaign;
  });

  app.patch<{ Params: { id: string }; Body: BodyBuat }>(
    "/campaigns/:id",
    async (req, reply) => {
      const updated = await repo.update(req.params.id, {
        name: req.body.name,
        subject: req.body.subject,
        body_text: req.body.body_text,
        body_html: req.body.body_html,
        segment_filter: req.body.segment_filter,
      });
      if (!updated) {
        // Bisa berarti tidak ada, bisa berarti sudah bukan draf. Keduanya
        // dijawab sama supaya tidak membocorkan keberadaan kampanye lain.
        return reply.code(409).send({
          pesan: "kampanye tidak ditemukan atau sudah tidak dapat disunting",
        });
      }
      return updated;
    },
  );

  app.post<{ Params: { id: string } }>("/campaigns/:id/preflight", async (req, reply) => {
    const campaign = await repo.get(req.params.id);
    if (!campaign) return reply.code(404).send({ pesan: "kampanye tidak ditemukan" });
    return preflight(req.params.id);
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/send", async (req, reply) => {
    const campaign = await repo.get(req.params.id);
    if (!campaign) return reply.code(404).send({ pesan: "kampanye tidak ditemukan" });

    const hasil = await preflight(req.params.id);
    if (!hasil.dapat_dikirim) {
      return reply.code(422).send({
        pesan: "kampanye tidak lolos pemeriksaan pra-kirim",
        ...hasil,
      });
    }

    const antre = await repo.susunAntrean(req.params.id);
    return {
      ...antre,
      status: "terjadwal",
      catatan:
        "Pengiriman dijalankan worker sesuai batas harian. " +
        "Pantau perkembangannya di laporan kampanye.",
    };
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/pause", async (req, reply) => {
    const updated = await repo.ubahStatus(req.params.id, "jeda");
    if (!updated) return reply.code(404).send({ pesan: "kampanye tidak ditemukan" });
    return updated;
  });

  app.post<{ Params: { id: string } }>("/campaigns/:id/resume", async (req, reply) => {
    const updated = await repo.ubahStatus(req.params.id, "terjadwal");
    if (!updated) return reply.code(404).send({ pesan: "kampanye tidak ditemukan" });
    return updated;
  });

  // ── Tindak lanjut ──────────────────────────────────────────────────────────

  /**
   * Komposisi reaksi atas kampanye ini, beserta daftar tindak lanjut yang
   * sudah dibuat darinya.
   *
   * Satu permintaan, bukan dua: layar tindak lanjut selalu membutuhkan
   * keduanya bersamaan — angka "berapa yang bereaksi" tidak berarti tanpa
   * "sudah ditindaklanjuti atau belum".
   */
  app.get<{ Params: { id: string } }>("/campaigns/:id/tindak-lanjut", async (req, reply) => {
    const campaign = await repo.get(req.params.id);
    if (!campaign) return reply.code(404).send({ pesan: "kampanye tidak ditemukan" });

    const [ringkasan, lanjutan] = await Promise.all([
      repo.ringkasanTindakLanjut(req.params.id, JENDELA_DIAM_HARI),
      repo.daftarLanjutan(req.params.id),
    ]);

    return {
      campaign: { id: campaign.id, name: campaign.name, status: campaign.status },
      jendela_diam_hari: JENDELA_DIAM_HARI,
      ringkasan,
      pemicu_tersedia: PEMICU.map((p) => ({ nilai: p, label: LABEL_PEMICU[p] })),
      lanjutan: lanjutan.map((c) => ({
        id: c.id,
        name: c.name,
        subject: c.subject,
        status: c.status,
        pemicu: c.pemicu,
        jeda_lanjutan_jam: c.jeda_lanjutan_jam,
        lanjutan_aktif: c.lanjutan_aktif,
        created_at: c.created_at,
      })),
    };
  });

  /**
   * Membuat kampanye tindak lanjut dari kampanye ini.
   *
   * Penerimanya TIDAK dipilih di sini dan tidak dapat dipilih: yang menentukan
   * adalah pemicu — siapa pun penerima induk yang bereaksi sesuai pemicu, saat
   * ini maupun minggu depan. Membiarkan daftar penerima ditetapkan di muka
   * akan mengunci tindak lanjut pada orang yang kebetulan sudah bereaksi saat
   * kampanyenya disusun, dan justru melewatkan yang bereaksi belakangan —
   * padahal itulah yang membuat pekerjaan ini tidak perlu dilakukan manual.
   */
  app.post<{
    Params: { id: string };
    Body: {
      name?: string;
      subject?: string;
      body_text?: string;
      body_html?: string | null;
      pemicu?: string;
      jeda_lanjutan_jam?: number;
      lanjutan_aktif?: boolean;
    };
  }>("/campaigns/:id/tindak-lanjut", async (req, reply) => {
    const induk = await repo.get(req.params.id);
    if (!induk) return reply.code(404).send({ pesan: "kampanye tidak ditemukan" });

    // Berantai satu tingkat saja. Tindak lanjut dari tindak lanjut membentuk
    // rantai yang tiap tingkatnya menyempit, dan yang paling mungkin terjadi
    // adalah pengguna kehilangan jejak berapa email yang sebenarnya diterima
    // satu orang. Kalau memang dibutuhkan, buat tindak lanjut kedua dari
    // kampanye induk yang sama dengan pemicu berbeda.
    if (induk.parent_campaign_id) {
      return reply.code(422).send({
        pesan: "kampanye ini sendiri adalah tindak lanjut — buat tindak lanjut dari kampanye induknya",
        kind: "berantai",
      });
    }

    const { name, subject, body_text } = req.body ?? {};
    if (!name || !subject || !body_text) {
      return reply.code(422).send({ pesan: "name, subject, dan body_text wajib diisi" });
    }
    if (!pemicuSah(req.body.pemicu)) {
      return reply.code(422).send({
        pesan: `pemicu wajib, salah satu dari: ${PEMICU.join(", ")}`,
        kind: "pemicu_tidak_dikenal",
      });
    }

    const jedaMentah = Number(req.body.jeda_lanjutan_jam ?? JEDA_BAWAAN_JAM);
    const jeda = Number.isFinite(jedaMentah)
      ? Math.min(Math.max(Math.floor(jedaMentah), 0), 24 * 90)
      : JEDA_BAWAAN_JAM;

    const lanjutan = await repo.create({
      name,
      subject,
      bodyText: body_text,
      bodyHtml: req.body.body_html ?? null,
      // Domain pengirim mengikuti induk. Menindaklanjuti percakapan dari
      // domain yang berbeda membuat penerima tidak mengenali pengirimnya, dan
      // memecah reputasi yang sedang dibangun ke dua domain sekaligus.
      senderDomain: induk.sender_domain,
      parentCampaignId: induk.id,
      pemicu: req.body.pemicu,
      jedaLanjutanJam: jeda,
      lanjutanAktif: req.body.lanjutan_aktif !== false,
    });

    return reply.code(201).send(lanjutan);
  });

  /** Menyalakan atau menghentikan pendaftaran bergulir. */
  app.post<{ Params: { id: string }; Body: { aktif?: boolean } }>(
    "/campaigns/:id/pendaftaran",
    async (req, reply) => {
      const aktif = req.body?.aktif !== false;
      const updated = await repo.ubahLanjutanAktif(req.params.id, aktif);
      if (!updated) {
        return reply.code(404).send({
          pesan: "kampanye tidak ditemukan atau bukan kampanye tindak lanjut",
        });
      }
      return updated;
    },
  );

  /**
   * Menandai bahwa seorang penerima membalas.
   *
   * Jalur manual, berdampingan dengan jalur webhook surat masuk. Dibutuhkan
   * karena balasan sering mendarat di kotak masuk biasa tim pemasaran, bukan
   * di alamat yang terpasang receipt rule SES — dan tanpa jalur ini, sinyal
   * ketertarikan paling kuat justru yang paling sering luput tercatat.
   */
  app.post<{ Params: { id: string }; Body: { email?: string; cuplikan?: string } }>(
    "/campaigns/:id/balasan",
    async (req, reply) => {
      const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
      if (!email) return reply.code(422).send({ pesan: "email pembalas wajib diisi" });

      const hasil = await repo.catatBalasan({
        email,
        campaignId: req.params.id,
        cuplikan: req.body?.cuplikan ?? null,
      });
      if (!hasil) {
        return reply.code(404).send({
          pesan: "tidak ada pengiriman ke alamat itu yang dapat ditautkan",
        });
      }
      req.log.info({ email, campaign_id: hasil.campaign_id }, "balasan dicatat manual");
      return hasil;
    },
  );

  app.get<{ Params: { id: string } }>("/campaigns/:id/report", async (req, reply) => {
    const campaign = await repo.get(req.params.id);
    if (!campaign) return reply.code(404).send({ pesan: "kampanye tidak ditemukan" });

    const f = await repo.funnel(req.params.id);
    const terkirim = f.sent;

    // Persentase hanya bermakna kalau ada yang terkirim. Membagi dengan nol
    // lalu menampilkan 0% akan terbaca sebagai "tidak ada masalah", padahal
    // yang benar adalah "belum ada yang bisa diukur" — kekeliruan yang sama
    // dihindari di /domain/health.
    const rasio = (n: number) =>
      terkirim === 0 ? null : Number(((n / terkirim) * 100).toFixed(2));

    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        started_at: campaign.started_at,
        finished_at: campaign.finished_at,
      },
      funnel: f,
      dampak_reputasi: {
        bounce_rate: rasio(f.bounced),
        complaint_rate: rasio(f.complained),
        sumber: terkirim === 0 ? "belum_ada_pengiriman" : "tersedia",
      },
    };
  });
}
