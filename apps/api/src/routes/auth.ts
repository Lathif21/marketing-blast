// Rute sesi: masuk, keluar, dan siapa yang sedang masuk.
//
// `/auth/login` adalah satu-satunya rute yang menerima kata sandi, dan
// satu-satunya yang dapat dicoba berulang oleh siapa pun dari internet. Dua
// hal karena itu ditegakkan di sini: pembatasan percobaan, dan balasan yang
// tidak membedakan "email tidak ada" dari "sandi salah".

import type { FastifyInstance, FastifyReply } from "fastify";
import { UMUR_SESI_JAM, buatSesi, hapusSesi, verifikasiKredensial } from "../auth/repo.js";
import { cookieKosong, cookieSesi } from "../auth/plugin.js";
import * as tenants from "../tenants/repo.js";

/**
 * Pembatasan percobaan masuk, di memori proses.
 *
 * Cukup untuk menahan percobaan sandi bertubi-tubi dari satu sumber, dan
 * sengaja TIDAK berpura-pura lebih: kalau nanti ada lebih dari satu proses API,
 * penghitung ini tidak dibagi antar-proses. Yang benar untuk keadaan itu adalah
 * pembatasan di tingkat proksi — dicatat di open-items.md, bukan diselesaikan
 * dengan tabel penghitung yang membuat setiap login menulis ke basis data.
 */
const percobaan = new Map<string, { jumlah: number; sampai: number }>();

const MAKS_PERCOBAAN = 8;
const JENDELA_MS = 10 * 60 * 1000;

function terlaluBanyak(kunci: string): boolean {
  const catatan = percobaan.get(kunci);
  if (!catatan) return false;
  if (Date.now() > catatan.sampai) {
    percobaan.delete(kunci);
    return false;
  }
  return catatan.jumlah >= MAKS_PERCOBAAN;
}

function catatGagal(kunci: string): void {
  const catatan = percobaan.get(kunci);
  if (!catatan || Date.now() > catatan.sampai) {
    percobaan.set(kunci, { jumlah: 1, sampai: Date.now() + JENDELA_MS });
    return;
  }
  catatan.jumlah += 1;
}

// Satu pesan untuk semua kegagalan kredensial. Membedakan "email tidak
// terdaftar" dari "sandi salah" mengubah endpoint ini menjadi alat untuk
// memetakan siapa saja yang punya akun di instalasi ini.
const GAGAL = { pesan: "Email atau kata sandi salah.", kind: "kredensial_salah" };

interface Konteks {
  id: string;
  email: string;
  nama: string;
  peran: string;
  tenant: {
    id: string;
    nama: string;
    slug: string;
    status: tenants.StatusTenant;
    alasan_beku: string | null;
  } | null;
  impersonasi: { tenantId: string; nama: string | null; slug: string | null } | null;
}

async function susunKonteks(
  pengguna: { id: string; email: string; nama: string; peran: string; tenant_id: string | null },
  impersonasi: Konteks["impersonasi"] = null,
): Promise<Konteks> {
  // Saat berimpersonasi, pelanggan yang ditampilkan adalah yang sedang
  // dimasuki — bukan `tenant_id` superadmin, yang memang selalu null.
  const tenantId = impersonasi?.tenantId ?? pengguna.tenant_id;
  const tenant = tenantId ? await tenants.ambil(tenantId) : null;

  return {
    id: pengguna.id,
    email: pengguna.email,
    nama: pengguna.nama,
    peran: pengguna.peran,
    tenant: tenant
      ? {
          id: tenant.id,
          nama: tenant.nama,
          slug: tenant.slug,
          status: tenant.status,
          alasan_beku: tenant.alasan_beku,
        }
      : null,
    impersonasi,
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { email?: string; sandi?: string } }>(
    "/auth/login",
    async (req, reply: FastifyReply) => {
      const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
      const sandi = typeof req.body?.sandi === "string" ? req.body.sandi : "";

      if (!email || !sandi) {
        return reply.code(422).send({ pesan: "email dan sandi wajib diisi" });
      }

      const kunci = `${req.ip}|${email.toLowerCase()}`;
      if (terlaluBanyak(kunci)) {
        req.log.warn({ ip: req.ip, email }, "percobaan masuk dibatasi");
        return reply.code(429).send({
          pesan: "Terlalu banyak percobaan. Coba lagi sepuluh menit lagi.",
          kind: "dibatasi",
        });
      }

      const pengguna = await verifikasiKredensial(email, sandi);
      if (!pengguna) {
        catatGagal(kunci);
        req.log.warn({ ip: req.ip, email }, "percobaan masuk gagal");
        return reply.code(401).send(GAGAL);
      }

      // Pelanggan nonaktif tidak dapat masuk. Pelanggan DIBEKUKAN masih bisa,
      // dan itu disengaja: yang dibekukan perlu melihat alasannya untuk
      // memperbaikinya, dan yang berhenti hanyalah pengiriman.
      if (pengguna.tenant_id) {
        const tenant = await tenants.ambil(pengguna.tenant_id);
        if (!tenant || tenant.status === "nonaktif") {
          req.log.warn({ email, tenant: pengguna.tenant_id }, "masuk ditolak, pelanggan nonaktif");
          return reply.code(403).send({
            pesan: "Akun perusahaan ini tidak aktif. Hubungi penyedia layanan.",
            kind: "tenant_nonaktif",
          });
        }
      }

      const sesi = await buatSesi(pengguna.id);
      percobaan.delete(kunci);

      req.log.info({ email, peran: pengguna.peran }, "masuk");
      return reply
        .header("set-cookie", cookieSesi(sesi.token, UMUR_SESI_JAM * 3600))
        .send(await susunKonteks(pengguna));
    },
  );

  app.post("/auth/logout", async (req, reply) => {
    if (req.auth) await hapusSesi(req.auth.token);
    return reply.header("set-cookie", cookieKosong()).send({ keluar: true });
  });

  app.get("/auth/me", async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ pesan: "belum masuk" });
    return susunKonteks(req.auth.pengguna, req.auth.impersonasi);
  });
}
