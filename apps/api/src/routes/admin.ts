// Kendali superadmin.
//
// Seluruh rute di berkas ini berjalan pada konteks `superadmin: true`, yang
// artinya penyaringan Row Level Security TIDAK berlaku. Konsekuensinya harus
// dipegang saat menambah query di sini: setiap query yang menyentuh data
// pelanggan WAJIB menyebut `tenant_id` sendiri. Di berkas lain kelalaian
// serupa tertahan policy; di berkas ini tidak ada yang menahannya.
//
// Itu sebabnya rute-rutenya dikumpulkan di satu tempat alih-alih ditempelkan
// ke rute yang sudah ada, dan setiap handler dibuka dengan `wajibSuperadmin`.
//
// Impersonasi punya aturannya sendiri: selama sedang masuk sebagai pelanggan,
// kendali superadmin ditutup (`wajibSuperadmin` membalas 409). Tanpa aturan
// itu, satu sesi bisa membaca data satu pelanggan sambil membekukan pelanggan
// lain, dan jejak auditnya menjadi tidak mungkin dibaca.

import type { FastifyInstance } from "fastify";
import { wajibSuperadmin } from "../auth/plugin.js";
import { query } from "../db.js";
import * as tenants from "../tenants/repo.js";
import * as audit from "../tenants/audit.js";
import {
  buatPengguna,
  cariPenggunaLewatEmail,
  daftarPengguna,
  setelImpersonasi,
  setelSandi,
  ubahAktifPengguna,
} from "../auth/repo.js";
import { MIN_PANJANG_SANDI, sandiCukupPanjang } from "../auth/password.js";

const bilangan = (v: unknown): number | null => {
  if (v === null) return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export async function adminRoutes(app: FastifyInstance) {
  // ── Pelanggan ──────────────────────────────────────────────────────────────

  app.get("/admin/tenants", async (req, reply) => {
    if (!wajibSuperadmin(req, reply)) return reply;
    return { items: await tenants.ringkasan() };
  });

  /**
   * Membuat pelanggan sekaligus admin pertamanya.
   *
   * Keduanya dalam satu langkah, bukan dua endpoint terpisah. Pelanggan tanpa
   * pengguna tidak dapat dimasuki siapa pun — dan pelanggan yang dibuat lalu
   * "diberi pengguna nanti" adalah pelanggan yang akan ditemukan sebulan
   * kemudian dalam keadaan tidak pernah bisa dipakai.
   */
  app.post<{
    Body: {
      nama?: string;
      slug?: string;
      kuota_kontak?: number | null;
      catatan?: string | null;
      admin?: { email?: string; nama?: string; sandi?: string };
    };
  }>("/admin/tenants", async (req, reply) => {
    if (!wajibSuperadmin(req, reply)) return reply;

    const nama = typeof req.body?.nama === "string" ? req.body.nama.trim() : "";
    const slug = typeof req.body?.slug === "string" ? req.body.slug.trim().toLowerCase() : "";
    const admin = req.body?.admin ?? {};
    const emailAdmin = typeof admin.email === "string" ? admin.email.trim() : "";
    const namaAdmin = typeof admin.nama === "string" ? admin.nama.trim() : "";
    const sandiAdmin = typeof admin.sandi === "string" ? admin.sandi : "";

    if (!nama || !slug) {
      return reply.code(422).send({ pesan: "nama dan slug wajib diisi" });
    }
    if (!tenants.SLUG_VALID.test(slug)) {
      return reply.code(422).send({
        pesan: "slug hanya boleh huruf kecil, angka, dan tanda hubung (3–40 karakter)",
        kind: "slug_tidak_sah",
      });
    }
    if (!emailAdmin || !namaAdmin) {
      return reply.code(422).send({ pesan: "admin.email dan admin.nama wajib diisi" });
    }
    if (!sandiCukupPanjang(sandiAdmin)) {
      return reply.code(422).send({
        pesan: `kata sandi admin minimal ${MIN_PANJANG_SANDI} karakter`,
        kind: "sandi_pendek",
      });
    }
    if (await cariPenggunaLewatEmail(emailAdmin)) {
      return reply.code(409).send({ pesan: "email itu sudah dipakai", kind: "email_terpakai" });
    }
    if (await tenants.ambilLewatSlug(slug)) {
      return reply.code(409).send({ pesan: "slug itu sudah dipakai", kind: "slug_terpakai" });
    }

    const tenant = await tenants.buat({
      nama,
      slug,
      kuotaKontak: bilangan(req.body?.kuota_kontak ?? null),
      catatan: req.body?.catatan ?? null,
    });

    const pengguna = await buatPengguna({
      tenantId: tenant.id,
      email: emailAdmin,
      nama: namaAdmin,
      peran: "admin",
      sandi: sandiAdmin,
    });

    const pelaku = { id: req.auth!.pengguna.id, email: req.auth!.pengguna.email };
    await audit.catat({
      pelaku,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      aksi: "tenant_dibuat",
      detail: { nama, admin: emailAdmin, kuota_kontak: tenant.kuota_kontak },
    });

    return reply.code(201).send({ tenant, admin: pengguna });
  });

  app.patch<{
    Params: { id: string };
    Body: { nama?: string; kuota_kontak?: number | null; catatan?: string | null };
  }>("/admin/tenants/:id", async (req, reply) => {
    if (!wajibSuperadmin(req, reply)) return reply;

    const tenant = await tenants.ubah(req.params.id, {
      nama: typeof req.body?.nama === "string" ? req.body.nama.trim() : undefined,
      kuotaKontak:
        req.body?.kuota_kontak === undefined ? undefined : bilangan(req.body.kuota_kontak),
      catatan: req.body?.catatan,
    });
    if (!tenant) return reply.code(404).send({ pesan: "pelanggan tidak ditemukan" });

    await audit.catat({
      pelaku: { id: req.auth!.pengguna.id, email: req.auth!.pengguna.email },
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      aksi: "tenant_diubah",
      detail: { ...req.body },
    });
    return tenant;
  });

  /**
   * Membekukan pengiriman.
   *
   * `alasan` wajib. Bukan formalitas: pelanggan yang pengirimannya berhenti
   * akan bertanya kenapa, dan jawabannya harus ada di sistem — bukan di
   * ingatan orang yang membekukan. Alasannya juga yang ditampilkan ke
   * pelanggan itu sendiri di layarnya.
   */
  app.post<{ Params: { id: string }; Body: { alasan?: string } }>(
    "/admin/tenants/:id/bekukan",
    async (req, reply) => {
      if (!wajibSuperadmin(req, reply)) return reply;

      const alasan = typeof req.body?.alasan === "string" ? req.body.alasan.trim() : "";
      if (!alasan) {
        return reply.code(422).send({
          pesan: "Alasan pembekuan wajib diisi — pelanggan akan melihatnya.",
          kind: "alasan_wajib",
        });
      }

      const hasil = await tenants.bekukan(req.params.id, alasan, req.auth!.pengguna.email);
      if (!hasil.tenant) return reply.code(404).send({ pesan: "pelanggan tidak ditemukan" });

      await audit.catat({
        pelaku: { id: req.auth!.pengguna.id, email: req.auth!.pengguna.email },
        tenantId: hasil.tenant.id,
        tenantSlug: hasil.tenant.slug,
        aksi: "tenant_dibekukan",
        detail: { alasan, sesi_dicabut: hasil.sesi_dicabut },
      });

      req.log.warn(
        { tenant: hasil.tenant.slug, oleh: req.auth!.pengguna.email },
        "pelanggan dibekukan",
      );
      return hasil;
    },
  );

  app.post<{ Params: { id: string } }>("/admin/tenants/:id/aktifkan", async (req, reply) => {
    if (!wajibSuperadmin(req, reply)) return reply;

    const hasil = await tenants.ubahStatus(req.params.id, "aktif");
    if (!hasil.tenant) return reply.code(404).send({ pesan: "pelanggan tidak ditemukan" });

    await audit.catat({
      pelaku: { id: req.auth!.pengguna.id, email: req.auth!.pengguna.email },
      tenantId: hasil.tenant.id,
      tenantSlug: hasil.tenant.slug,
      aksi: "tenant_diaktifkan",
    });
    return hasil;
  });

  app.post<{ Params: { id: string } }>("/admin/tenants/:id/nonaktifkan", async (req, reply) => {
    if (!wajibSuperadmin(req, reply)) return reply;

    const hasil = await tenants.ubahStatus(req.params.id, "nonaktif");
    if (!hasil.tenant) return reply.code(404).send({ pesan: "pelanggan tidak ditemukan" });

    await audit.catat({
      pelaku: { id: req.auth!.pengguna.id, email: req.auth!.pengguna.email },
      tenantId: hasil.tenant.id,
      tenantSlug: hasil.tenant.slug,
      aksi: "tenant_dinonaktifkan",
      detail: { sesi_dicabut: hasil.sesi_dicabut },
    });
    return hasil;
  });

  // ── Pengguna pelanggan ─────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>("/admin/tenants/:id/pengguna", async (req, reply) => {
    if (!wajibSuperadmin(req, reply)) return reply;
    return { items: await daftarPengguna(req.params.id) };
  });

  app.post<{
    Params: { id: string };
    Body: { email?: string; nama?: string; sandi?: string; peran?: string };
  }>("/admin/tenants/:id/pengguna", async (req, reply) => {
    if (!wajibSuperadmin(req, reply)) return reply;

    const tenant = await tenants.ambil(req.params.id);
    if (!tenant) return reply.code(404).send({ pesan: "pelanggan tidak ditemukan" });

    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const nama = typeof req.body?.nama === "string" ? req.body.nama.trim() : "";
    const sandi = typeof req.body?.sandi === "string" ? req.body.sandi : "";
    const peran = req.body?.peran === "operator" ? "operator" : "admin";

    if (!email || !nama) return reply.code(422).send({ pesan: "email dan nama wajib diisi" });
    if (!sandiCukupPanjang(sandi)) {
      return reply.code(422).send({
        pesan: `kata sandi minimal ${MIN_PANJANG_SANDI} karakter`,
        kind: "sandi_pendek",
      });
    }
    if (await cariPenggunaLewatEmail(email)) {
      return reply.code(409).send({ pesan: "email itu sudah dipakai", kind: "email_terpakai" });
    }

    const pengguna = await buatPengguna({
      tenantId: tenant.id,
      email,
      nama,
      peran,
      sandi,
    });

    await audit.catat({
      pelaku: { id: req.auth!.pengguna.id, email: req.auth!.pengguna.email },
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      aksi: "pengguna_dibuat",
      detail: { email, peran },
    });
    return reply.code(201).send(pengguna);
  });

  app.post<{ Params: { id: string }; Body: { aktif?: boolean } }>(
    "/admin/pengguna/:id/aktif",
    async (req, reply) => {
      if (!wajibSuperadmin(req, reply)) return reply;

      const aktif = req.body?.aktif !== false;
      const pengguna = await ubahAktifPengguna(req.params.id, aktif);
      if (!pengguna) {
        return reply.code(404).send({ pesan: "pengguna tidak ditemukan atau tidak dapat diubah" });
      }

      await audit.catat({
        pelaku: { id: req.auth!.pengguna.id, email: req.auth!.pengguna.email },
        tenantId: pengguna.tenant_id,
        aksi: aktif ? "pengguna_diaktifkan" : "pengguna_dinonaktifkan",
        detail: { email: pengguna.email },
      });
      return pengguna;
    },
  );

  app.post<{ Params: { id: string }; Body: { sandi?: string } }>(
    "/admin/pengguna/:id/sandi",
    async (req, reply) => {
      if (!wajibSuperadmin(req, reply)) return reply;

      const sandi = typeof req.body?.sandi === "string" ? req.body.sandi : "";
      if (!sandiCukupPanjang(sandi)) {
        return reply.code(422).send({
          pesan: `kata sandi minimal ${MIN_PANJANG_SANDI} karakter`,
          kind: "sandi_pendek",
        });
      }

      const berhasil = await setelSandi(req.params.id, sandi);
      if (!berhasil) return reply.code(404).send({ pesan: "pengguna tidak ditemukan" });

      await audit.catat({
        pelaku: { id: req.auth!.pengguna.id, email: req.auth!.pengguna.email },
        aksi: "sandi_disetel",
        detail: { user_id: req.params.id },
      });
      return { disetel: true };
    },
  );

  // ── Melihat data pelanggan ─────────────────────────────────────────────────

  /**
   * Pratinjau data satu pelanggan, hanya baca.
   *
   * Setiap pemanggilan dicatat di `admin_audit`. Ini bukan hiasan kepatuhan:
   * kewenangan membaca data pelanggan tidak dapat dibedakan dari
   * penyalahgunaan tanpa catatan, dan pencatatannya berada di jalur yang sama
   * dengan pembacaannya supaya tidak mungkin membaca tanpa tercatat.
   *
   * Perhatikan setiap query di bawah menyebut `tenant_id` sendiri. Pada
   * konteks superadmin, RLS tidak menyaring apa pun — melewatkannya berarti
   * mengembalikan data seluruh pelanggan di bawah nama satu pelanggan.
   */
  app.get<{ Params: { id: string } }>("/admin/tenants/:id/pratinjau", async (req, reply) => {
    if (!wajibSuperadmin(req, reply)) return reply;

    const tenant = await tenants.ambil(req.params.id);
    if (!tenant) return reply.code(404).send({ pesan: "pelanggan tidak ditemukan" });

    const [kontak, kampanye] = await Promise.all([
      query(
        `SELECT email::text AS email, company_name, status::text AS status,
                respons::text AS respons, imported_at
           FROM contacts WHERE tenant_id = $1
          ORDER BY imported_at DESC LIMIT 25`,
        [tenant.id],
      ),
      query(
        `SELECT id, name, subject, status::text AS status, created_at
           FROM campaigns WHERE tenant_id = $1
          ORDER BY created_at DESC LIMIT 25`,
        [tenant.id],
      ),
    ]);

    await audit.catat({
      pelaku: { id: req.auth!.pengguna.id, email: req.auth!.pengguna.email },
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      aksi: "data_pelanggan_dilihat",
      detail: { kontak: kontak.rowCount, kampanye: kampanye.rowCount },
    });

    return {
      tenant: { id: tenant.id, nama: tenant.nama, slug: tenant.slug },
      kontak: kontak.rows,
      kampanye: kampanye.rows,
      catatan: "Akses ini tercatat di jejak audit atas nama Anda.",
    };
  });

  // ── Impersonasi ────────────────────────────────────────────────────────────

  /**
   * Masuk sebagai pelanggan.
   *
   * Yang berubah hanyalah konteks basis data sesi ini; sesinya tetap milik
   * superadmin. Itu yang membuat jejaknya tetap benar — tindakan yang
   * dilakukan selama impersonasi tetap tercatat atas nama superadmin, bukan
   * atas nama pelanggan yang dimasuki.
   */
  app.post<{ Body: { tenant_id?: string } }>("/admin/impersonasi", async (req, reply) => {
    if (!wajibSuperadmin(req, reply)) return reply;

    const tenantId = typeof req.body?.tenant_id === "string" ? req.body.tenant_id : "";
    const tenant = tenantId ? await tenants.ambil(tenantId) : null;
    if (!tenant) return reply.code(404).send({ pesan: "pelanggan tidak ditemukan" });

    await setelImpersonasi(req.auth!.token, tenant.id);
    await audit.catat({
      pelaku: { id: req.auth!.pengguna.id, email: req.auth!.pengguna.email },
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      aksi: "impersonasi_mulai",
    });

    req.log.warn(
      { tenant: tenant.slug, oleh: req.auth!.pengguna.email },
      "impersonasi dimulai",
    );
    return { masuk_sebagai: { id: tenant.id, nama: tenant.nama, slug: tenant.slug } };
  });

  /**
   * Keluar dari impersonasi.
   *
   * TIDAK memakai `wajibSuperadmin`: rute itu menolak sesi yang sedang
   * berimpersonasi, dan yang membutuhkan rute ini justru sesi tersebut. Yang
   * diperiksa di sini karena itu perannya saja.
   */
  app.post("/admin/impersonasi/keluar", async (req, reply) => {
    const auth = req.auth;
    if (!auth || auth.pengguna.peran !== "superadmin") {
      return reply.code(404).send({ pesan: "tidak ditemukan" });
    }

    const sebelumnya = auth.impersonasi;
    await setelImpersonasi(auth.token, null);

    if (sebelumnya) {
      await audit.catat({
        pelaku: { id: auth.pengguna.id, email: auth.pengguna.email },
        tenantId: sebelumnya.tenantId,
        tenantSlug: sebelumnya.slug,
        aksi: "impersonasi_selesai",
      });
    }
    return { keluar: true };
  });

  // ── Jejak audit ────────────────────────────────────────────────────────────

  app.get<{ Querystring: { page?: string; per_page?: string; tenant_id?: string } }>(
    "/admin/audit",
    async (req, reply) => {
      if (!wajibSuperadmin(req, reply)) return reply;

      const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
      const perPage = Math.min(Math.max(Number(req.query.per_page ?? 50) || 50, 1), 200);
      return audit.daftar(page, perPage, req.query.tenant_id ?? null);
    },
  );
}
