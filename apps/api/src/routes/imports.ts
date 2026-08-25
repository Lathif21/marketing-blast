// Alur impor: unggah → pemetaan + validasi → commit.
//
// Validasi dan commit dipisah supaya pengguna melihat ringkasan sebelum satu
// baris pun tersimpan.

import type { FastifyInstance } from "fastify";
import { parseCsv, toRecords } from "../lib/csv.js";
import { DecryptError, decryptEnc } from "../lib/fernet.js";
import { HARVESTER_MAPPING, isHarvesterFile } from "../import/harvester.js";
import * as staging from "../import/staging.js";
import {
  CONSENT_SOURCES,
  cancel,
  commit,
  existingAmong,
  type ConsentSource,
} from "../import/repo.js";
import { collectEmails, validateRows, type RowInput } from "../import/validate.js";
import { suppressedAmong } from "../suppression/repo.js";

const PREVIEW_ROWS = 5;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Memetakan satu baris mentah menjadi masukan validasi. */
function toRowInputs(
  records: Record<string, string>[],
  mapping: Record<string, string>,
  fromHarvester: boolean,
): RowInput[] {
  const pick = (record: Record<string, string>, field: string) => {
    const column = mapping[field];
    return column ? (record[column] ?? "") : "";
  };

  return records.map((record) =>
    fromHarvester
      ? {
          email: record.email ?? "",
          company: record.company ?? "",
          website: record.website ?? "",
          emailSource: record.email_source ?? "",
          sourceStatus: record.status ?? "",
          address: record.address ?? "",
          searchQuery: record.search_query ?? "",
          whatsapp: record.whatsapp ?? "",
          otherWhatsapp: record.other_whatsapp ?? "",
          phone: record.phone ?? "",
          otherEmails: record.other_emails ?? "",
        }
      : {
          email: pick(record, "email"),
          company: pick(record, "company"),
          website: pick(record, "website"),
          address: pick(record, "address"),
          phone: pick(record, "phone"),
        },
  );
}

export async function importRoutes(app: FastifyInstance) {
  // ─── Unggah ────────────────────────────────────────────────────────────────
  app.post("/imports", async (req, reply) => {
    const file = await req.file({ limits: { fileSize: MAX_FILE_BYTES } });
    if (!file) return reply.code(400).send({ error: "tidak ada berkas diunggah" });

    const buffer = await file.toBuffer();
    const filename = file.filename || "tanpa-nama";
    const password = (file.fields?.password as { value?: string } | undefined)?.value ?? "";

    let text: string;
    if (filename.toLowerCase().endsWith(".enc")) {
      if (!password) {
        return reply.code(400).send({
          error: "berkas terenkripsi butuh password dekripsi",
          kind: "password_kosong",
        });
      }
      try {
        text = decryptEnc(buffer, password);
      } catch (err) {
        if (err instanceof DecryptError) {
          // Dua kegagalan yang berbeda artinya bagi pengguna dilaporkan
          // berbeda, meski Fernet melihat keduanya sama.
          return reply.code(400).send({ error: err.message, kind: err.kind });
        }
        throw err;
      }
    } else {
      text = buffer.toString("utf8");
    }

    const parsed = parseCsv(text);
    if (parsed.header.length === 0) {
      return reply.code(400).send({ error: "berkas kosong atau bukan CSV" });
    }

    const records = toRecords(parsed);
    const fromHarvester = isHarvesterFile(parsed.header);

    const staged = staging.stage({
      filename,
      header: parsed.header,
      records,
      fromHarvester,
    });

    return {
      // Ini id SESI impor (di memori), bukan id baris `import_batches` —
      // baris itu baru dibuat saat commit. `commit` mengembalikan id yang
      // berbeda dengan nama field yang sama; keduanya sengaja diterima
      // `DELETE /imports/:id` karena artinya bagi pengguna sama: batalkan.
      batch_id: staged.id,
      filename,
      row_count: records.length,
      columns: parsed.header,
      rows: parsed.rows.slice(0, PREVIEW_ROWS),
      // Bila cocok, langkah pemetaan dilewati dan yang ditampilkan hanya
      // konfirmasi.
      detected_source: fromHarvester ? "contact_harvester" : null,
      suggested_mapping: fromHarvester ? HARVESTER_MAPPING : null,
      consent_sources: CONSENT_SOURCES,
    };
  });

  // ─── Pemetaan + validasi ───────────────────────────────────────────────────
  app.post<{
    Params: { id: string };
    Body: { mapping?: Record<string, string>; consent_source?: string; declared_by?: string };
  }>("/imports/:id/mapping", async (req, reply) => {
    const staged = staging.get(req.params.id);
    if (!staged) return reply.code(404).send({ error: "sesi impor tidak ditemukan" });

    const consentSource = req.body?.consent_source;

    // Berkas tanpa sumber izin menghentikan SELURUH impor, bukan barisnya.
    // Ini bukan kesalahan per baris — pengguna belum menyatakan dasar izinnya
    // (04-aturan-kepatuhan.md §5).
    if (!consentSource || !CONSENT_SOURCES.includes(consentSource as ConsentSource)) {
      return reply.code(422).send({
        error:
          "Sumber izin wajib dinyatakan sebelum impor dilanjutkan. " +
          "Tanpa itu tidak ada satu baris pun yang dapat disimpan.",
        kind: "consent_source_wajib",
        pilihan: CONSENT_SOURCES,
      });
    }

    const declaredBy = (req.body?.declared_by ?? "").trim();
    if (!declaredBy) {
      return reply.code(422).send({
        error: "Pernyataan sumber izin harus tercatat atas nama siapa.",
        kind: "declared_by_wajib",
      });
    }

    const mapping = staged.fromHarvester ? {} : (req.body?.mapping ?? {});
    if (!staged.fromHarvester && !mapping.email) {
      return reply.code(422).send({ error: "kolom email wajib dipetakan", kind: "mapping_email" });
    }

    const rowInputs = toRowInputs(staged.records, mapping, staged.fromHarvester);
    const emails = collectEmails(rowInputs);

    const [existing, suppressed] = await Promise.all([
      existingAmong(emails),
      suppressedAmong(emails),
    ]);

    const summary = validateRows(rowInputs, {
      existing,
      suppressed,
      fromHarvester: staged.fromHarvester,
    });

    staging.update(staged.id, {
      mapping,
      consentSource,
      declaredBy,
      rowInputs,
    });

    return {
      batch_id: staged.id,
      accepted: summary.accepted,
      quarantined: summary.quarantined,
      duplicates: summary.duplicate,
      rejected: summary.rejected,
      notes: buildNotes(summary),
    };
  });

  // ─── Commit ────────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>("/imports/:id/commit", async (req, reply) => {
    const staged = staging.get(req.params.id);
    if (!staged) return reply.code(404).send({ error: "sesi impor tidak ditemukan" });
    if (!staged.consentSource || !staged.rowInputs) {
      return reply.code(409).send({ error: "jalankan langkah pemetaan dan validasi dulu" });
    }

    const emails = collectEmails(staged.rowInputs);
    const [existing, suppressed] = await Promise.all([
      existingAmong(emails),
      suppressedAmong(emails),
    ]);

    const summary = validateRows(staged.rowInputs, {
      existing,
      suppressed,
      fromHarvester: staged.fromHarvester,
    });

    const result = await commit({
      filename: staged.filename,
      rowCount: staged.records.length,
      consentSource: staged.consentSource as ConsentSource,
      declaredBy: staged.declaredBy ?? "tidak diketahui",
      summary,
    });

    staging.drop(staged.id);
    // Mulai titik ini, id sesi tidak berlaku lagi. Yang dikembalikan adalah id
    // baris `import_batches` — itulah yang dipakai membatalkan batch nanti,
    // sampai 30 hari.
    return { batch_id: result.batchId, imported: result.imported };
  });

  // ─── Batalkan ──────────────────────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>("/imports/:id", async (req, reply) => {
    // Sesi yang belum di-commit cukup dibuang dari memori — tidak ada apa pun
    // di basis data yang perlu dibersihkan.
    if (staging.drop(req.params.id)) {
      return reply.code(200).send({ dibatalkan: "sesi", deleted: 0 });
    }

    const result = await cancel(req.params.id);
    if (!result.ok) {
      const code = result.reason === "tidak_ditemukan" ? 404 : 409;
      return reply.code(code).send({ error: result.reason });
    }

    return {
      dibatalkan: "batch",
      deleted: result.deleted,
      kept_suppressed: result.keptSuppressed,
    };
  });
}

function buildNotes(summary: {
  accepted: number;
  quarantined: number;
  duplicate: number;
  rejected: number;
  rows: { outcome: string; reason?: string }[];
}) {
  const notes: { type: "warn" | "info" | "error"; text: string }[] = [];

  if (summary.accepted > 0) {
    notes.push({
      type: "info",
      text:
        `${summary.accepted} kontak akan disimpan berstatus karantina — ` +
        `tidak ada yang langsung dapat dikirimi sebelum lolos verifikasi alamat`,
    });
  }
  if (summary.quarantined > 0) {
    notes.push({
      type: "warn",
      text:
        `${summary.quarantined} di antaranya alamat hasil tebakan (email_source = guessed), ` +
        `penyebab utama pemantulan keras`,
    });
  }
  if (summary.duplicate > 0) {
    notes.push({
      type: "info",
      text: `${summary.duplicate} alamat email duplikat tidak akan diimpor`,
    });
  }
  if (summary.rejected > 0) {
    const byReason = new Map<string, number>();
    for (const row of summary.rows) {
      if (row.outcome !== "ditolak") continue;
      const key = row.reason ?? "lainnya";
      byReason.set(key, (byReason.get(key) ?? 0) + 1);
    }
    const detail = [...byReason]
      .map(([reason, n]) => `${n} ${reason.replace(/_/g, " ")}`)
      .join(", ");
    notes.push({ type: "error", text: `${summary.rejected} baris ditolak: ${detail}` });
  }
  return notes;
}
