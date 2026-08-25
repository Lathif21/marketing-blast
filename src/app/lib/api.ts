// Pemanggilan API terpusat. Satu-satunya tempat SPA menyentuh jaringan.
//
// Belum dipakai layar mana pun — layar masih membaca lib/mock.ts. Modul ini
// ada supaya titik sambungnya sudah tetap sebelum backend ditulis: mengganti
// mock berarti menukar impor, bukan menyebar `fetch` ke seluruh layar.
//
// Daftar endpoint mengikuti 01-arsitektur.md. Dua endpoint sengaja TIDAK ada
// di sini karena bukan milik SPA:
//   GET  /unsubscribe/:token  — publik, tanpa autentikasi, dibuka penerima
//   POST /webhooks/ses        — server ke server, dipanggil Amazon SES
//
// Tidak ada `deleteSuppression`. Itu bukan kelalaian: daftar penekanan bersifat
// permanen di setiap lapisan (04-aturan-kepatuhan.md §2).

import type {
  Campaign,
  Contact,
  ContactStatus,
  ConsentSource,
  DomainHealth,
  FunnelStage,
  SuppressionEntry,
} from "./types";

const BASE_URL = import.meta.env.VITE_API_URL ?? "/api";

class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });

  const body = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (body as { pesan?: string; message?: string } | null)?.pesan ??
      (body as { pesan?: string; message?: string } | null)?.message ??
      `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, body, message);
  }

  return body as T;
}

const json = (data: unknown) => JSON.stringify(data);

// ─── Impor ───────────────────────────────────────────────────────────────────

export interface ImportPreview {
  batch_id: string;
  filename: string;
  row_count: number;
  columns: string[];
  rows: string[][];
  /** Terisi bila susunan kolom cocok dengan 13 kolom Contact Harvester. */
  detected_source: "contact_harvester" | null;
}

export interface ImportValidation {
  accepted: number;
  quarantined: number;
  duplicates: number;
  rejected: number;
  notes: { type: "warn" | "info" | "error"; text: string }[];
}

/** Unggah berkas CSV atau .enc. Password hanya dikirim untuk berkas terenkripsi. */
export const uploadImport = (file: File, password?: string) => {
  const form = new FormData();
  form.append("file", file);
  if (password) form.append("password", password);
  return request<ImportPreview>("/imports", { method: "POST", body: form });
};

/**
 * Simpan pemetaan kolom lalu jalankan validasi.
 * `consent_source` wajib — impor ditolak server bila kosong (§5).
 */
export const saveImportMapping = (
  batchId: string,
  mapping: Record<string, string>,
  consentSource: ConsentSource,
) =>
  request<ImportValidation>(`/imports/${batchId}/mapping`, {
    method: "POST",
    body: json({ mapping, consent_source: consentSource }),
  });

export const commitImport = (batchId: string) =>
  request<{ imported: number }>(`/imports/${batchId}/commit`, { method: "POST" });

/** Batalkan batch dan hapus kontak asalnya. Alamat yang sudah ditekan tetap tinggal. */
export const cancelImport = (batchId: string) =>
  request<void>(`/imports/${batchId}`, { method: "DELETE" });

// ─── Kontak ──────────────────────────────────────────────────────────────────

export interface ContactQuery {
  status?: ContactStatus;
  consent_source?: ConsentSource;
  search?: string;
  page?: number;
  per_page?: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

export const listContacts = (query: ContactQuery = {}) => {
  const params = new URLSearchParams(
    Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)]),
  );
  const qs = params.toString();
  return request<Paginated<Contact>>(`/contacts${qs ? `?${qs}` : ""}`);
};

// ─── Kampanye ────────────────────────────────────────────────────────────────

export interface CampaignDraft {
  name: string;
  segment_id: string;
  subject: string;
  body: string;
}

export const createCampaign = (draft: CampaignDraft) =>
  request<Campaign>("/campaigns", { method: "POST", body: json(draft) });

/** Satu butir hasil pemeriksaan pra-kirim. */
export interface PreflightCheck {
  butir:
    | "identitas_pengirim"
    | "tautan_berhenti"
    | "penekanan_dikeluarkan"
    | "karantina_dikeluarkan"
    | "batas_pemanasan"
    | "sumber_izin";
  lolos: boolean;
  jumlah?: number;
  pesan?: string;
}

export interface PreflightResult {
  dapat_dikirim: boolean;
  pemeriksaan: PreflightCheck[];
}

/**
 * Pemeriksaan kepatuhan dijalankan di server. Hasilnya mengikat: butir yang
 * gagal memblokir pengiriman, dan UI tidak boleh menawarkan jalan pintas.
 */
export const preflightCampaign = (campaignId: string) =>
  request<PreflightResult>(`/campaigns/${campaignId}/preflight`, { method: "POST" });

export const sendCampaign = (campaignId: string) =>
  request<{ queued: number }>(`/campaigns/${campaignId}/send`, { method: "POST" });

export interface CampaignReport {
  campaign: Campaign;
  funnel: FunnelStage[];
  health_impact: { label: string; before: string; after: string; delta: string; warn: boolean }[];
}

export const getCampaignReport = (campaignId: string) =>
  request<CampaignReport>(`/campaigns/${campaignId}/report`);

// ─── Domain & penekanan ──────────────────────────────────────────────────────

export const getDomainHealth = () => request<DomainHealth>("/domain/health");

/** Hanya baca. Tidak ada padanan tulis atau hapus, dan tidak boleh ditambahkan. */
export const listSuppression = (page = 1, perPage = 50) =>
  request<Paginated<SuppressionEntry>>(`/suppression?page=${page}&per_page=${perPage}`);

export { ApiError };
