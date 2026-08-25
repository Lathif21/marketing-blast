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
