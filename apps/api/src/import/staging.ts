// Penyimpanan sementara berkas yang sedang diimpor, sebelum commit.
//
// Alasan ia ada di memori dan bukan di tabel: pembatalan pada tahap ringkasan
// tidak boleh menyisakan apa pun. Kalau baris sudah masuk basis data saat
// unggah, "tidak menyisakan apa pun" berubah jadi janji yang harus ditegakkan
// kode pembersih — dan pembersih yang gagal meninggalkan kontak tak bertuan.
//
// Konsekuensinya jujur: sesi impor hilang kalau proses API restart di tengah
// jalan. Pada satu VPS satu proses itu dapat diterima; pengguna cukup mengunggah
// ulang. Kalau nanti API dijalankan lebih dari satu instance, ini yang pertama
// harus pindah ke tabel.

import { randomUUID } from "node:crypto";
import type { RowInput } from "./validate.js";

export interface StagedImport {
  id: string;
  filename: string;
  header: string[];
  /** Baris mentah, sudah dipetakan ke nama kolom. */
  records: Record<string, string>[];
  fromHarvester: boolean;
  createdAt: number;
  /** Diisi pada langkah pemetaan. */
  mapping?: Record<string, string>;
  consentSource?: string;
  declaredBy?: string;
  rowInputs?: RowInput[];
}

const TTL_MS = 60 * 60 * 1000;
const store = new Map<string, StagedImport>();

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, staged] of store) {
    if (staged.createdAt < cutoff) store.delete(id);
  }
}

export function stage(
  input: Omit<StagedImport, "id" | "createdAt">,
): StagedImport {
  sweep();
  const staged: StagedImport = { ...input, id: randomUUID(), createdAt: Date.now() };
  store.set(staged.id, staged);
  return staged;
}

export function get(id: string): StagedImport | undefined {
  sweep();
  return store.get(id);
}

export function update(id: string, patch: Partial<StagedImport>): StagedImport | undefined {
  const staged = store.get(id);
  if (!staged) return undefined;
  Object.assign(staged, patch);
  return staged;
}

export function drop(id: string): boolean {
  return store.delete(id);
}

export function size(): number {
  sweep();
  return store.size;
}
