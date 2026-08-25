// Pemanggilan API terpusat. Satu-satunya tempat SPA menyentuh jaringan.
//
// Server memakai snake_case (mengikuti kolom basis data), UI memakai camelCase.
// Penerjemahannya terjadi di sini, bukan di layar — supaya perubahan bentuk
// respons berhenti di satu berkas.
//
// Daftar endpoint mengikuti 01-arsitektur.md. Dua endpoint sengaja TIDAK ada
// di sini karena bukan milik SPA:
//   GET  /unsubscribe/:token  — publik, tanpa autentikasi, dibuka penerima
//   POST /webhooks/ses        — server ke server, dipanggil Amazon SES
//
// Tidak ada `deleteSuppression`. Itu bukan kelalaian: daftar penekanan bersifat
// permanen di setiap lapisan, sampai ke hak peran basis data
// (04-aturan-kepatuhan.md §2).

import type {
  Campaign,
  Contact,
  ContactStatus,
  ConsentSource,
  EmailOrigin,
  FunnelStage,
  SuppressionEntry,
  SuppressionReason,
} from "./types";

const BASE_URL = import.meta.env.VITE_API_URL ?? "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Content-Type hanya disetel kalau permintaannya benar-benar membawa body.
 *
 * Menyetel `application/json` pada permintaan tanpa body membuat server
 * menolaknya dengan 400 "Body cannot be empty" — dan itu mengenai justru
 * endpoint yang memang tidak butuh body: commit dan pembatalan impor.
 * `FormData` sengaja dilewati: browser harus menyusun sendiri header
 * multipart-nya, lengkap dengan boundary.
 */
function buildHeaders(init?: RequestInit): HeadersInit {
  const punyaBody = init?.body !== undefined && init.body !== null;
  const multipart = init?.body instanceof FormData;

  return {
    ...(punyaBody && !multipart ? { "Content-Type": "application/json" } : {}),
    ...init?.headers,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: buildHeaders(init),
    });
  } catch (err) {
    // Gagal menyambung sama sekali. Dibedakan dari galat HTTP supaya layar
    // dapat menyarankan hal yang benar: server mati, bukan permintaan salah.
    throw new ApiError(0, null, `Tidak dapat menghubungi server: ${(err as Error).message}`);
  }

  const body = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    const asObject = body as { error?: string; pesan?: string; message?: string } | null;
    const message =
      asObject?.error ?? asObject?.pesan ?? asObject?.message ?? `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, body, message);
  }

  return body as T;
}

const json = (data: unknown) => JSON.stringify(data);

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

// ─── Kontak ──────────────────────────────────────────────────────────────────

interface ApiContact {
  id: string;
  email: string;
  domain: string;
  company_name: string | null;
  consent_source: ConsentSource;
  email_origin: EmailOrigin;
  status: ContactStatus;
  imported_at: string;
}

const toContact = (c: ApiContact): Contact => ({
  id: c.id,
  company: c.company_name ?? c.domain,
  email: c.email,
  consent: c.consent_source,
  emailOrigin: c.email_origin,
  status: c.status,
  date: formatDate(c.imported_at),
});

export interface ContactQuery {
  status?: ContactStatus;
  consent_source?: ConsentSource;
  search?: string;
  page?: number;
  per_page?: number;
}

export async function listContacts(query: ContactQuery = {}): Promise<Paginated<Contact>> {
  const params = new URLSearchParams(
    Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)]),
  );
  const qs = params.toString();
  const result = await request<Paginated<ApiContact>>(`/contacts${qs ? `?${qs}` : ""}`);
  return { ...result, items: result.items.map(toContact) };
}

export const getContactDistribution = () =>
  request<{ aktif: number; karantina: number; diblokir: number }>("/contacts/distribution");

// ─── Daftar penekanan ────────────────────────────────────────────────────────

interface ApiSuppression {
  email: string;
  reason: SuppressionReason;
  campaign_id: string | null;
  created_at: string;
}

export async function listSuppression(page = 1, perPage = 50): Promise<Paginated<SuppressionEntry>> {
  const result = await request<Paginated<ApiSuppression>>(
    `/suppression?page=${page}&per_page=${perPage}`,
  );
  return {
    ...result,
    items: result.items.map((s) => ({
      email: s.email,
      reason: s.reason,
      date: formatDate(s.created_at),
    })),
  };
}

// ─── Impor ───────────────────────────────────────────────────────────────────

export interface ImportPreview {
  /**
   * Id SESI impor, hidup di memori server sampai commit atau kedaluwarsa.
   * BUKAN id batch di basis data — `commitImport` mengembalikan id yang
   * berbeda dengan nama field yang sama.
   */
  batch_id: string;
  filename: string;
  row_count: number;
  columns: string[];
  rows: string[][];
  /** Terisi bila susunan kolom cocok dengan 13 kolom Contact Harvester. */
  detected_source: "contact_harvester" | null;
  suggested_mapping: Record<string, string> | null;
  consent_sources: ConsentSource[];
}

export interface ImportValidation {
  batch_id: string;
  accepted: number;
  quarantined: number;
  duplicates: number;
  rejected: number;
  notes: { type: "warn" | "info" | "error"; text: string }[];
}

/** Unggah CSV atau .enc. Password hanya dikirim untuk berkas terenkripsi. */
export function uploadImport(file: File, password?: string) {
  const form = new FormData();
  if (password) form.append("password", password);
  form.append("file", file);
  return request<ImportPreview>("/imports", { method: "POST", body: form });
}

/**
 * Simpan pemetaan kolom lalu jalankan validasi.
 * `consent_source` wajib — server menolak seluruh impor bila kosong, bukan
 * hanya barisnya (04-aturan-kepatuhan.md §5).
 */
export const saveImportMapping = (
  batchId: string,
  mapping: Record<string, string>,
  consentSource: ConsentSource,
  declaredBy: string,
) =>
  request<ImportValidation>(`/imports/${batchId}/mapping`, {
    method: "POST",
    body: json({ mapping, consent_source: consentSource, declared_by: declaredBy }),
  });

/**
 * Menyimpan baris yang lolos. `batchId` di sini adalah id SESI dari
 * `uploadImport`; yang dikembalikan adalah id batch di basis data — itulah
 * yang dipakai `cancelImport` setelah impor tersimpan.
 */
export const commitImport = (batchId: string) =>
  request<{ batch_id: string; imported: number }>(`/imports/${batchId}/commit`, {
    method: "POST",
  });

/**
 * Batalkan. Menerima id sesi (sebelum commit — tidak menyisakan apa pun) atau
 * id batch basis data (setelah commit — menghapus kontaknya).
 * Alamat yang sudah masuk daftar penekanan tetap tinggal dalam kedua kasus.
 */
export const cancelImport = (batchId: string) =>
  request<{ dibatalkan: string; deleted: number; kept_suppressed?: number }>(
    `/imports/${batchId}`,
    { method: "DELETE" },
  );

// ─── Kesehatan domain ────────────────────────────────────────────────────────

export type Ketersediaan = "tersedia" | "belum_ada_pengiriman" | "belum_terpasang";

/**
 * Bentuknya mengikuti server, termasuk `null` pada metrik yang belum punya
 * sumber data. `null` di sini WAJIB dibedakan dari 0 saat ditampilkan:
 * bounce 0% terbaca sehat, bounce null berarti belum ada yang bisa diukur.
 */
export interface DomainHealth {
  domain: string;
  warmup: {
    stage: number;
    total_stages: number;
    daily_limit: number | null;
    sent_today: number;
    remaining_today: number | null;
    days_sending: number | null;
  };
  reputation: {
    bounce_rate_7d: number | null;
    complaint_rate_7d: number | null;
    thresholds: {
      bounce: { perhatian: number; kritis: number };
      keluhan: { perhatian: number; kritis: number };
    };
  };
  suppression_total: number;
  sumber: {
    warmup: string;
    pengiriman: Ketersediaan;
    reputasi: Ketersediaan;
  };
  diperbarui_pada: string;
}

export const getDomainHealth = () => request<DomainHealth>("/domain/health");

// ─── Belum ada di server (Fase 2) ────────────────────────────────────────────

export interface CampaignReport {
  campaign: Campaign;
  funnel: FunnelStage[];
  health_impact: { label: string; before: string; after: string; delta: string; warn: boolean }[];
}

export const getCampaignReport = (campaignId: string) =>
  request<CampaignReport>(`/campaigns/${campaignId}/report`);
