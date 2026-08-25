import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";
import { CONSENT_SOURCES, type ConsentSource } from "../import/repo.js";

const STATUSES = ["aktif", "karantina", "diblokir"] as const;
type Status = (typeof STATUSES)[number];

interface Query {
  status?: string;
  consent_source?: string;
  search?: string;
  page?: string;
  per_page?: string;
}

export async function contactRoutes(app: FastifyInstance) {
  app.get<{ Querystring: Query }>("/contacts", async (req, reply) => {
    const { status, consent_source, search } = req.query;

    if (status && !STATUSES.includes(status as Status)) {
      return reply.code(400).send({ error: `status tidak dikenal: ${status}` });
    }
    if (consent_source && !CONSENT_SOURCES.includes(consent_source as ConsentSource)) {
      return reply.code(400).send({ error: `sumber izin tidak dikenal: ${consent_source}` });
    }

    const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
    const perPage = Math.min(Math.max(Number(req.query.per_page ?? 50) || 50, 1), 200);

    const where: string[] = [];
    const params: unknown[] = [];

    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (consent_source) {
      params.push(consent_source);
      where.push(`consent_source = $${params.length}`);
    }
    if (search?.trim()) {
      params.push(`%${search.trim()}%`);
      // citext membuat perbandingan email tidak peka huruf besar-kecil;
      // nama perusahaan perlu ILIKE sendiri.
      where.push(`(company_name ILIKE $${params.length} OR email::text ILIKE $${params.length})`);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const items = await pool.query(
      `SELECT id, email::text AS email, domain, company_name, consent_source,
              consent_strength, consent_date, email_origin, status,
              reference_contact, address, acquisition_note, import_batch_id,
              imported_at
         FROM contacts
         ${clause}
        ORDER BY imported_at DESC, email
        LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
      params,
    );

    const total = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM contacts ${clause}`,
      params,
    );

    return {
      items: items.rows,
      total: Number(total.rows[0].count),
      page,
      per_page: perPage,
    };
  });

  /** Ringkasan untuk panel distribusi di dasbor. */
  app.get("/contacts/distribution", async () => {
    const { rows } = await pool.query<{ status: string; count: string }>(
      "SELECT status::text AS status, count(*)::text AS count FROM contacts GROUP BY status",
    );
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
    return {
      aktif: byStatus.aktif ?? 0,
      karantina: byStatus.karantina ?? 0,
      diblokir: byStatus.diblokir ?? 0,
    };
  });
}
