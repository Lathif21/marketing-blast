import type { FastifyInstance } from "fastify";
import { query } from "../db.js";
import { SEMUA_CONSENT_SOURCE, type ConsentSource } from "../import/repo.js";
import { MAKS_SEKALI, aktifkanKontak, karantinakanKontak } from "../contacts/activate.js";
import {
  MAKS_HAPUS_SEKALI,
  daftarKontakDiam,
  hapusKontakDiam,
  ringkasanRespons,
} from "../contacts/respons.js";
import { JENDELA_DIAM_HARI, LABEL_RESPONS, SEMUA_RESPONS } from "../campaign/engagement.js";

const STATUSES = ["aktif", "karantina", "diblokir"] as const;
type Status = (typeof STATUSES)[number];

interface Query {
  status?: string;
  respons?: string;
  consent_source?: string;
  search?: string;
  page?: string;
  per_page?: string;
}

/** Bilangan bulat dalam rentang, dengan nilai bawaan bila tidak masuk akal. */
function clampInt(raw: string | undefined, bawaan: number, min: number, max: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return bawaan;
  return Math.min(Math.max(n, min), max);
}

export async function contactRoutes(app: FastifyInstance) {
  app.get<{ Querystring: Query }>("/contacts", async (req, reply) => {
    const { status, respons, consent_source, search } = req.query;

    if (status && !STATUSES.includes(status as Status)) {
      return reply.code(400).send({ error: `status tidak dikenal: ${status}` });
    }
    if (respons && !SEMUA_RESPONS.includes(respons as (typeof SEMUA_RESPONS)[number])) {
      return reply.code(400).send({ error: `respons tidak dikenal: ${respons}` });
    }
    if (consent_source && !SEMUA_CONSENT_SOURCE.includes(consent_source as ConsentSource)) {
      return reply.code(400).send({ error: `sumber izin tidak dikenal: ${consent_source}` });
    }

    // Dibulatkan ke bawah dan dijepit. Tanpa pembulatan, `?page=1.02` menjadi
    // OFFSET pecahan yang dibulatkan Postgres diam-diam — dua nilai halaman
    // yang berbeda bisa mengembalikan baris yang sama tanpa alasan yang
    // terlihat dari luar.
    const page = clampInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const perPage = clampInt(req.query.per_page, 50, 1, 200);

    const where: string[] = [];
    const params: unknown[] = [];

    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    if (respons) {
      params.push(respons);
      where.push(`respons = $${params.length}::respons_kontak`);
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

    // LIMIT dan OFFSET ikut diparameterkan, bukan disisipkan ke string SQL.
    // Nilainya memang sudah dijepit jadi bilangan bulat, tapi menyisipkan
    // angka langsung ke SQL adalah kebiasaan yang cepat menular ke tempat
    // yang nilainya tidak sebersih ini.
    const [items, total] = await Promise.all([
      query(
        `SELECT id, email::text AS email, domain, company_name, consent_source,
                consent_strength, consent_date, email_origin, status,
                reference_contact, address, acquisition_note, import_batch_id,
                imported_at, respons, last_sent_at, last_engaged_at
           FROM contacts
           ${clause}
          ORDER BY imported_at DESC, email
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, perPage, (page - 1) * perPage],
      ),
      query<{ count: string }>(
        `SELECT count(*)::text AS count FROM contacts ${clause}`,
        params,
      ),
    ]);

    const jumlah = Number(total.rows[0].count);

    return {
      items: items.rows,
      total: jumlah,
      page,
      per_page: perPage,
      total_pages: Math.max(Math.ceil(jumlah / perPage), 1),
    };
  });


  /**
   * Mengaktifkan kontak karantina.
   *
   * Aturan yang menolak — diblokir, tersuppress, alamat tebakan — ditegakkan
   * di `contacts/activate.ts`, bukan di sini dan bukan di UI. Rute ini hanya
   * memvalidasi bentuk permintaan.
   */
  app.post<{
    Body: { ids?: unknown; dinyatakan_oleh?: unknown; izinkan_tebakan?: unknown };
  }>("/contacts/activate", async (req, reply) => {
    const body = req.body ?? {};

    const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string") : [];
    if (ids.length === 0) {
      return reply.code(422).send({ error: "tidak ada kontak yang dipilih", kind: "ids_kosong" });
    }
    if (ids.length > MAKS_SEKALI) {
      return reply.code(422).send({
        error: `maksimal ${MAKS_SEKALI} kontak sekali aktivasi`,
        kind: "terlalu_banyak",
      });
    }

    // Penilaian manusia harus punya nama. Tanpa ini, aktivasi alamat tebakan
    // tidak dapat ditelusuri saat pemantulan melonjak.
    const dinyatakanOleh = typeof body.dinyatakan_oleh === "string" ? body.dinyatakan_oleh.trim() : "";
    if (!dinyatakanOleh) {
      return reply.code(422).send({
        error: "Aktivasi harus tercatat atas nama siapa.",
        kind: "dinyatakan_oleh_wajib",
      });
    }

    const hasil = await aktifkanKontak({
      ids,
      dinyatakanOleh,
      izinkanTebakan: body.izinkan_tebakan === true,
    });

    req.log.info(
      { oleh: dinyatakanOleh, diaktifkan: hasil.diaktifkan, tebakan: body.izinkan_tebakan === true },
      "aktivasi kontak",
    );
    return hasil;
  });

  /** Mengembalikan kontak aktif ke karantina. */
  app.post<{ Body: { ids?: unknown } }>("/contacts/quarantine", async (req, reply) => {
    const body = req.body ?? {};
    const ids = Array.isArray(body.ids) ? body.ids.filter((v): v is string => typeof v === "string") : [];
    if (ids.length === 0) {
      return reply.code(422).send({ error: "tidak ada kontak yang dipilih", kind: "ids_kosong" });
    }
    return karantinakanKontak(ids);
  });

  // ── Respons dan retensi ────────────────────────────────────────────────────

  /** Sebaran penilaian respons, untuk layar tindak lanjut. */
  app.get("/contacts/respons", async () => {
    const ringkasan = await ringkasanRespons();
    return {
      jendela_diam_hari: JENDELA_DIAM_HARI,
      ringkasan,
      label: LABEL_RESPONS,
    };
  });

  /**
   * Kontak yang melewati jendela penilaian tanpa satu pun reaksi.
   *
   * Mereka sudah berhenti menerima kampanye lanjutan dengan sendirinya —
   * tidak ada pemicu yang mereka penuhi. Layar ini hanya menawarkan langkah
   * berikutnya: menghapusnya sekalian.
   */
  app.get<{ Querystring: { page?: string; per_page?: string } }>(
    "/contacts/retensi",
    async (req) => {
      const page = clampInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
      const perPage = clampInt(req.query.per_page, 50, 1, 200);
      const hasil = await daftarKontakDiam(page, perPage);
      return { ...hasil, jendela_diam_hari: JENDELA_DIAM_HARI };
    },
  );

  /**
   * Menghapus kontak tanpa respons.
   *
   * Menuntut nama pelakunya dengan alasan yang sama seperti aktivasi: ini
   * penilaian manusia yang tidak dapat dibatalkan, dan penilaian semacam itu
   * perlu meninggalkan catatan. Server tetap menolak id yang bukan `diam`
   * apa pun yang dikirim UI.
   */
  app.post<{ Body: { ids?: unknown; dinyatakan_oleh?: unknown } }>(
    "/contacts/retensi/hapus",
    async (req, reply) => {
      const body = req.body ?? {};
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((v): v is string => typeof v === "string")
        : [];

      if (ids.length === 0) {
        return reply.code(422).send({ error: "tidak ada kontak yang dipilih", kind: "ids_kosong" });
      }
      if (ids.length > MAKS_HAPUS_SEKALI) {
        return reply.code(422).send({
          error: `maksimal ${MAKS_HAPUS_SEKALI} kontak sekali hapus`,
          kind: "terlalu_banyak",
        });
      }

      const oleh = typeof body.dinyatakan_oleh === "string" ? body.dinyatakan_oleh.trim() : "";
      if (!oleh) {
        return reply.code(422).send({
          error: "Penghapusan harus tercatat atas nama siapa.",
          kind: "dinyatakan_oleh_wajib",
        });
      }

      const hasil = await hapusKontakDiam(ids, oleh);
      req.log.info({ oleh, ...hasil }, "penghapusan kontak tanpa respons");
      return hasil;
    },
  );

  /** Ringkasan untuk panel distribusi di dasbor. */
  app.get("/contacts/distribution", async () => {
    const { rows } = await query<{ status: string; count: string }>(
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
