// Jejak tindakan superadmin.
//
// Kewenangan superadmin mencakup melihat data pelanggan dan masuk sebagai
// pelanggan. Keduanya sah untuk dukungan, dan keduanya tidak dapat dibedakan
// dari penyalahgunaan tanpa catatan. Yang membuat akses semacam itu dapat
// dipertanggungjawabkan bukan pembatasannya — dukungan memang butuh akses —
// melainkan jejaknya.
//
// Pencatatan di sini sengaja TIDAK melempar saat gagal. Bukan karena jejaknya
// tidak penting, tapi karena kegagalan menulis jejak tidak boleh membatalkan
// tindakan yang sudah terjadi: pelanggan yang sudah dibekukan lalu dibalas
// "gagal" akan dibekukan dua kali oleh orang yang mengira percobaan pertama
// tidak jadi. Yang benar adalah tindakannya berlaku, dan kegagalan jejaknya
// muncul di log server.

import { queryGlobal } from "../db.js";

export interface Pelaku {
  id: string | null;
  email: string;
}

/** Daftar aksi yang dicatat. Tetap, supaya laporan audit dapat dikelompokkan. */
export type AksiAudit =
  | "tenant_dibuat"
  | "tenant_diubah"
  | "tenant_dibekukan"
  | "tenant_diaktifkan"
  | "tenant_dinonaktifkan"
  | "pengguna_dibuat"
  | "pengguna_dinonaktifkan"
  | "pengguna_diaktifkan"
  | "sandi_disetel"
  | "impersonasi_mulai"
  | "impersonasi_selesai"
  | "data_pelanggan_dilihat";

export async function catat(input: {
  pelaku: Pelaku;
  tenantId?: string | null;
  tenantSlug?: string | null;
  aksi: AksiAudit;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await queryGlobal(
      `INSERT INTO admin_audit (actor_id, actor_email, tenant_id, tenant_slug, aksi, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.pelaku.id,
        input.pelaku.email,
        input.tenantId ?? null,
        input.tenantSlug ?? null,
        input.aksi,
        JSON.stringify(input.detail ?? {}),
      ],
    );
  } catch (err) {
    console.error(
      `[audit] GAGAL mencatat "${input.aksi}" oleh ${input.pelaku.email}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

export interface BarisAudit {
  id: string;
  actor_email: string;
  tenant_slug: string | null;
  aksi: AksiAudit;
  detail: Record<string, unknown>;
  created_at: string;
}

export async function daftar(
  page = 1,
  perPage = 50,
  tenantId?: string | null,
): Promise<{ items: BarisAudit[]; total: number; page: number; per_page: number }> {
  const limit = Math.min(Math.max(perPage, 1), 200);
  const offset = (Math.max(page, 1) - 1) * limit;
  const filter = tenantId ? "WHERE tenant_id = $3" : "";
  const params: unknown[] = tenantId ? [limit, offset, tenantId] : [limit, offset];

  const [items, total] = await Promise.all([
    queryGlobal<BarisAudit>(
      `SELECT id, actor_email::text AS actor_email, tenant_slug::text AS tenant_slug,
              aksi, detail, created_at
         FROM admin_audit
         ${filter}
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2`,
      params,
    ),
    queryGlobal<{ count: string }>(
      `SELECT count(*)::text AS count FROM admin_audit ${tenantId ? "WHERE tenant_id = $1" : ""}`,
      tenantId ? [tenantId] : [],
    ),
  ]);

  return {
    items: items.rows,
    total: Number(total.rows[0].count),
    page: Math.max(page, 1),
    per_page: limit,
  };
}
