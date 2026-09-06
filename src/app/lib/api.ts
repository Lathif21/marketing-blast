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
    // Sesi berakhir di tengah pemakaian — kedaluwarsa, atau dicabut karena
    // pelanggannya dibekukan. Disiarkan sebagai kejadian supaya App dapat
    // kembali ke layar masuk sekaligus; tanpa itu, yang terlihat pengguna
    // adalah layar yang setiap tombolnya gagal tanpa penjelasan.
    //
    // `/auth/me` dikecualikan: pemeriksaan sesi saat aplikasi baru dibuka
    // memang wajar menjawab 401, dan menyiarkannya di sana hanya membuat
    // pemuatan pertama menyiarkan "sesi habis" untuk sesi yang belum pernah
    // ada.
    if (res.status === 401 && !path.startsWith("/auth/")) {
      window.dispatchEvent(new Event("mb:sesi-habis"));
    }

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

export type AlasanTolakAktivasi =
  | "tidak_ditemukan"
  | "sudah_aktif"
  | "diblokir"
  | "ada_di_penekanan"
  | "alamat_tebakan";

export interface HasilAktivasi {
  diaktifkan: number;
  ditolak: { id: string; email: string | null; alasan: AlasanTolakAktivasi }[];
  ringkasan: Record<AlasanTolakAktivasi, number>;
}

/**
 * Mengaktifkan kontak karantina.
 *
 * `izinkanTebakan` membuka alamat hasil tebakan. Ia TIDAK melonggarkan
 * penolakan lain: kontak diblokir dan alamat yang sudah ditekan tetap ditolak
 * server, apa pun yang dikirim UI.
 */
export const activateContacts = (
  ids: string[],
  dinyatakanOleh: string,
  izinkanTebakan = false,
) =>
  request<HasilAktivasi>("/contacts/activate", {
    method: "POST",
    body: json({ ids, dinyatakan_oleh: dinyatakanOleh, izinkan_tebakan: izinkanTebakan }),
  });

/** Mengembalikan kontak aktif ke karantina. */
export const quarantineContacts = (ids: string[]) =>
  request<{ dikarantina: number }>("/contacts/quarantine", {
    method: "POST",
    body: json({ ids }),
  });

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
  sender: { name: string; address: string; postal_address: string };
  warmup: {
    stage: number;
    total_stages: number;
    daily_limit: number | null;
    sent_today: number;
    remaining_today: number | null;
    total_terkirim: number;
    /** Jadwal lengkap, untuk menggambar runway tanpa menyalin angkanya. */
    jadwal: { stage: number; daily_limit: number | null; hari_paling_cepat: number }[];
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

// ─── Kampanye ────────────────────────────────────────────────────────────────

export interface Campaign2 {
  id: string;
  name: string;
  subject: string;
  status: string;
}

export const createCampaign = (input: {
  name: string;
  subject: string;
  body_text: string;
  contact_ids: string[];
}) =>
  request<Campaign2>("/campaigns", {
    method: "POST",
    body: json({
      name: input.name,
      subject: input.subject,
      body_text: input.body_text,
      // Penerima dipilih satu per satu, bukan lewat segmen. Daftar kosong
      // berarti tidak ada penerima — server tidak menafsirkannya sebagai
      // "kirim ke semua".
      segment_filter: { contact_ids: input.contact_ids },
    }),
  });

export type ButirPreflight =
  | "identitas_pengirim"
  | "tautan_berhenti"
  | "penekanan_dikeluarkan"
  | "karantina_dikeluarkan"
  | "batas_pemanasan"
  | "sumber_izin"
  | "penanda_terisi";

export interface HasilPreflight {
  dapat_dikirim: boolean;
  pemeriksaan: {
    butir: ButirPreflight;
    lolos: boolean;
    peringatan?: boolean;
    jumlah?: number;
    pesan?: string;
  }[];
  ringkasan: {
    kandidat: number;
    layak_kirim: number;
    tersuppress: number;
    terkarantina: number;
    sisa_kuota: number | null;
    tahap_pemanasan: number;
    tanggal_muat: string | null;
  };
}

/**
 * Pemeriksaan pra-kirim dijalankan server. Hasilnya mengikat: butir yang gagal
 * memblokir pengiriman, dan UI tidak boleh menawarkan jalan pintas.
 */
export const preflightCampaign = (id: string) =>
  request<HasilPreflight>(`/campaigns/${id}/preflight`, { method: "POST" });

export const sendCampaign = (id: string) =>
  request<{ diantrekan: number; dilewati: number; catatan: string }>(
    `/campaigns/${id}/send`,
    { method: "POST" },
  );

// ─── Belum ada di server (Fase 2) ────────────────────────────────────────────

export interface CampaignReport {
  campaign: Campaign;
  funnel: FunnelStage[];
  health_impact: { label: string; before: string; after: string; delta: string; warn: boolean }[];
}

export const getCampaignReport = (campaignId: string) =>
  request<CampaignReport>(`/campaigns/${campaignId}/report`);

// ─── Tindak lanjut ───────────────────────────────────────────────────────────

export type Pemicu = "membalas" | "diklik" | "dibuka" | "apa_saja";

export type Respons = "belum_ada" | "menunggu" | "tertarik" | "menolak" | "diam";

export interface CampaignRingkas {
  id: string;
  name: string;
  subject: string;
  status: string;
  parent_campaign_id: string | null;
  pemicu: Pemicu | null;
  jeda_lanjutan_jam: number;
  lanjutan_aktif: boolean;
  created_at: string;
}

export const listCampaigns = (page = 1, perPage = 50) =>
  request<Paginated<CampaignRingkas>>(`/campaigns?page=${page}&per_page=${perPage}`);

export interface RingkasanTindakLanjut {
  terkirim: number;
  membalas: number;
  diklik: number;
  dibuka: number;
  /** Bereaksi dengan cara apa pun. BUKAN penjumlahan tiga angka di atas —
   *  satu orang bisa membuka lalu mengklik lalu membalas. */
  bereaksi: number;
  menolak: number;
  diam: number;
  menunggu: number;
}

export interface TindakLanjut {
  campaign: { id: string; name: string; status: string };
  jendela_diam_hari: number;
  ringkasan: RingkasanTindakLanjut;
  pemicu_tersedia: { nilai: Pemicu; label: string }[];
  lanjutan: CampaignRingkas[];
}

export const getTindakLanjut = (campaignId: string) =>
  request<TindakLanjut>(`/campaigns/${campaignId}/tindak-lanjut`);

/**
 * Membuat kampanye tindak lanjut.
 *
 * Tidak ada `contact_ids` di sini, dan itu inti fiturnya: yang menentukan
 * penerima adalah `pemicu`, sehingga orang yang bereaksi minggu depan ikut
 * terjaring tanpa ada yang perlu menyusun ulang daftarnya.
 */
export const createFollowUp = (
  campaignId: string,
  input: {
    name: string;
    subject: string;
    body_text: string;
    pemicu: Pemicu;
    jeda_lanjutan_jam: number;
  },
) =>
  request<CampaignRingkas>(`/campaigns/${campaignId}/tindak-lanjut`, {
    method: "POST",
    body: json(input),
  });

/** Menyalakan atau menghentikan pendaftaran bergulir tanpa membatalkan kampanyenya. */
export const ubahPendaftaran = (campaignId: string, aktif: boolean) =>
  request<CampaignRingkas>(`/campaigns/${campaignId}/pendaftaran`, {
    method: "POST",
    body: json({ aktif }),
  });

/**
 * Menandai bahwa seseorang membalas.
 *
 * Jalur manual, untuk balasan yang mendarat di kotak masuk biasa tim pemasaran
 * alih-alih di alamat yang terpasang aturan penerimaan SES.
 */
export const catatBalasan = (campaignId: string, email: string, cuplikan?: string) =>
  request<{ recipient_id: string; campaign_id: string }>(`/campaigns/${campaignId}/balasan`, {
    method: "POST",
    body: json({ email, cuplikan }),
  });

// ─── Retensi kontak tanpa respons ────────────────────────────────────────────

export const getRingkasanRespons = () =>
  request<{
    jendela_diam_hari: number;
    ringkasan: Record<Respons, number>;
    label: Record<Respons, string>;
  }>("/contacts/respons");

export interface KontakDiam {
  id: string;
  email: string;
  company_name: string | null;
  last_sent_at: string | null;
  hari_diam: number;
}

export const listKontakDiam = (page = 1, perPage = 50) =>
  request<Paginated<KontakDiam> & { jendela_diam_hari: number }>(
    `/contacts/retensi?page=${page}&per_page=${perPage}`,
  );

/**
 * Menghapus kontak tanpa respons. Menuntut nama pelakunya dengan alasan yang
 * sama seperti aktivasi: penilaian manusia yang tidak dapat dibatalkan perlu
 * meninggalkan catatan.
 *
 * Server tetap menolak id yang bukan berstatus `diam`, apa pun yang dikirim
 * layar ini.
 */
export const hapusKontakDiam = (ids: string[], dinyatakanOleh: string) =>
  request<{ dihapus: number; dilewati: number }>("/contacts/retensi/hapus", {
    method: "POST",
    body: json({ ids, dinyatakan_oleh: dinyatakanOleh }),
  });

// ─── Sesi ────────────────────────────────────────────────────────────────────
//
// Token sesi hidup di cookie `HttpOnly`, jadi tidak ada token yang dipegang
// berkas ini — dan tidak ada yang dapat dibaca skrip pihak ketiga yang
// tersisip. Peramban melampirkannya sendiri karena SPA dan API berada pada
// origin yang sama (vite mem-proksi `/api`).

export type Peran = "superadmin" | "admin" | "operator";
export type StatusTenant = "aktif" | "dibekukan" | "nonaktif";

export interface SesiSaya {
  id: string;
  email: string;
  nama: string;
  peran: Peran;
  /** `null` untuk superadmin yang belum masuk sebagai pelanggan mana pun. */
  tenant: {
    id: string;
    nama: string;
    slug: string;
    status: StatusTenant;
    alasan_beku: string | null;
  } | null;
  impersonasi: { tenantId: string; nama: string | null; slug: string | null } | null;
}

export const login = (email: string, sandi: string) =>
  request<SesiSaya>("/auth/login", { method: "POST", body: json({ email, sandi }) });

export const logout = () => request<{ keluar: boolean }>("/auth/logout", { method: "POST" });

/**
 * Siapa yang sedang masuk. Melempar `ApiError` 401 bila belum — pemanggilnya
 * yang memutuskan itu berarti "tampilkan layar masuk", bukan "galat".
 */
export const sesiSaya = () => request<SesiSaya>("/auth/me");

// ─── Kendali superadmin ──────────────────────────────────────────────────────

export interface RingkasanTenant {
  id: string;
  nama: string;
  slug: string;
  status: StatusTenant;
  kuota_kontak: number | null;
  catatan: string | null;
  alasan_beku: string | null;
  dibekukan_pada: string | null;
  dibekukan_oleh: string | null;
  created_at: string;
  domain: string | null;
  warmup_stage: number | null;
  kontak: number;
  kontak_aktif: number;
  kampanye: number;
  penekanan: number;
  pengguna: number;
  terkirim_7h: number;
  bounce_7h: number;
  keluhan_7h: number;
  /** `null` berarti belum ada pengiriman 7 hari terakhir — BUKAN 0%. */
  bounce_rate_7h: number | null;
  complaint_rate_7h: number | null;
}

export const listTenants = () => request<{ items: RingkasanTenant[] }>("/admin/tenants");

export const createTenant = (input: {
  nama: string;
  slug: string;
  kuota_kontak: number | null;
  admin: { email: string; nama: string; sandi: string };
}) => request<{ tenant: RingkasanTenant }>("/admin/tenants", { method: "POST", body: json(input) });

export const updateTenant = (
  id: string,
  patch: { nama?: string; kuota_kontak?: number | null; catatan?: string | null },
) => request<RingkasanTenant>(`/admin/tenants/${id}`, { method: "PATCH", body: json(patch) });

/** Alasan wajib — pelanggan melihatnya di layarnya sendiri. */
export const bekukanTenant = (id: string, alasan: string) =>
  request<{ sesi_dicabut: number }>(`/admin/tenants/${id}/bekukan`, {
    method: "POST",
    body: json({ alasan }),
  });

export const aktifkanTenant = (id: string) =>
  request<unknown>(`/admin/tenants/${id}/aktifkan`, { method: "POST" });

export const nonaktifkanTenant = (id: string) =>
  request<unknown>(`/admin/tenants/${id}/nonaktifkan`, { method: "POST" });

export interface PenggunaTenant {
  id: string;
  email: string;
  nama: string;
  peran: Peran;
  aktif: boolean;
  last_login_at: string | null;
}

export const listPengguna = (tenantId: string) =>
  request<{ items: PenggunaTenant[] }>(`/admin/tenants/${tenantId}/pengguna`);

export const createPengguna = (
  tenantId: string,
  input: { email: string; nama: string; sandi: string; peran: "admin" | "operator" },
) =>
  request<PenggunaTenant>(`/admin/tenants/${tenantId}/pengguna`, {
    method: "POST",
    body: json(input),
  });

export const ubahAktifPengguna = (id: string, aktif: boolean) =>
  request<PenggunaTenant>(`/admin/pengguna/${id}/aktif`, { method: "POST", body: json({ aktif }) });

export const setelSandiPengguna = (id: string, sandi: string) =>
  request<{ disetel: boolean }>(`/admin/pengguna/${id}/sandi`, {
    method: "POST",
    body: json({ sandi }),
  });

/**
 * Pratinjau data satu pelanggan. Setiap pemanggilan tercatat di jejak audit
 * atas nama superadmin yang membukanya — server yang mencatat, bukan layar
 * ini, supaya tidak mungkin membaca tanpa tercatat.
 */
export const pratinjauTenant = (id: string) =>
  request<{
    tenant: { id: string; nama: string; slug: string };
    kontak: {
      email: string;
      company_name: string | null;
      status: string;
      respons: string;
      imported_at: string;
    }[];
    kampanye: { id: string; name: string; subject: string; status: string; created_at: string }[];
    catatan: string;
  }>(`/admin/tenants/${id}/pratinjau`);

export const mulaiImpersonasi = (tenantId: string) =>
  request<{ masuk_sebagai: { id: string; nama: string; slug: string } }>("/admin/impersonasi", {
    method: "POST",
    body: json({ tenant_id: tenantId }),
  });

export const keluarImpersonasi = () =>
  request<{ keluar: boolean }>("/admin/impersonasi/keluar", { method: "POST" });

export interface BarisAudit {
  id: string;
  actor_email: string;
  tenant_slug: string | null;
  aksi: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export const listAudit = (page = 1, perPage = 50) =>
  request<Paginated<BarisAudit>>(`/admin/audit?page=${page}&per_page=${perPage}`);

export const LABEL_AKSI: Record<string, string> = {
  tenant_dibuat: "Pelanggan dibuat",
  tenant_diubah: "Pelanggan diubah",
  tenant_dibekukan: "Pengiriman dibekukan",
  tenant_diaktifkan: "Pelanggan diaktifkan",
  tenant_dinonaktifkan: "Pelanggan dinonaktifkan",
  pengguna_dibuat: "Pengguna dibuat",
  pengguna_dinonaktifkan: "Pengguna dinonaktifkan",
  pengguna_diaktifkan: "Pengguna diaktifkan",
  sandi_disetel: "Kata sandi disetel",
  impersonasi_mulai: "Masuk sebagai pelanggan",
  impersonasi_selesai: "Keluar dari pelanggan",
  data_pelanggan_dilihat: "Data pelanggan dilihat",
};

// ─── Integrasi Gmail ─────────────────────────────────────────────────────────
//
// Tidak ada token yang pernah dipegang berkas ini. Alur izinnya berlangsung
// antara peramban pengguna dan Google; yang kita kirim hanyalah permintaan
// "beri saya URL-nya", lalu peramban berpindah ke sana.

export type StatusGmail = "aktif" | "perlu_sambung_ulang" | "dicabut";

export interface KoneksiGmail {
  id: string;
  email: string;
  status: StatusGmail;
  terhubung_oleh: string;
  terhubung_pada: string;
  last_sync_at: string | null;
  last_error: string | null;
  balasan_tercatat: number;
  kontak_ditambahkan: number;
}

export const getGmail = () =>
  request<{
    aktif: boolean;
    scopes: string[];
    koneksi: KoneksiGmail[];
    catatan: string | null;
  }>("/integrasi/gmail");

/** Mengembalikan URL halaman izin Google. Peramban yang berpindah ke sana. */
export const mulaiGmail = () =>
  request<{ url: string }>("/integrasi/gmail/mulai", { method: "POST" });

export const sinkronGmail = (id: string) =>
  request<{
    dibaca: number;
    balasan: number;
    kontakBaru: number;
    ditolak: Record<string, number>;
  }>(`/integrasi/gmail/${id}/sinkron`, { method: "POST" });

export const putusGmail = (id: string) =>
  request<{ diputus: boolean; catatan: string }>(`/integrasi/gmail/${id}/putus`, {
    method: "POST",
  });

/** Alasan penolakan kandidat kontak, sesuai `AlasanTolak` di server. */
export const LABEL_TOLAK: Record<string, string> = {
  satu_arah: "tidak pernah dibalas",
  otomatis: "alamat mesin",
  internal: "rekan satu domain",
  kiriman_massal: "buletin atau notifikasi",
  tanpa_alamat: "alamat tidak terbaca",
};
