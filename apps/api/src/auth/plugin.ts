// Autentikasi dan pemasangan konteks pelanggan.
//
// Dua hook `onRequest`, dan urutannya bukan kebetulan:
//
//   1. `kenali` — membaca cookie sesi, memuat pengguna, memutuskan pelanggan
//      mana yang dilayani. Asinkron, dan berjalan LEBIH DULU karena hook
//      berikutnya membutuhkan hasilnya.
//   2. `pasangKonteks` — memasukkan konteks itu ke AsyncLocalStorage. Bentuk
//      callback (`done`), bukan async: `AsyncLocalStorage.run` hanya mencakup
//      apa yang dijalankan DI DALAMNYA, jadi memanggil `done()` dari dalam
//      `run` adalah yang membuat seluruh hook dan handler sesudahnya berada di
//      dalam konteks yang sama. Versi async akan keluar dari `run` sebelum
//      handler-nya jalan, dan setiap query akan melempar "tanpa konteks".
//
// Konteksnya dibersihkan di `onResponse`. Ini pasangan yang wajib ada:
// koneksi yang kembali ke kolam sambil masih membawa `app.tenant_id`
// pelanggan sebelumnya akan melayani permintaan pelanggan lain dengan
// penyaringan yang salah.
//
// ── Rute publik ─────────────────────────────────────────────────────────────
//
// Tiga jalur berjalan tanpa sesi, dan harus tetap begitu:
//
//   /health           — pemeriksa dari luar tidak punya akun
//   /unsubscribe/*    — penerima tidak punya akun, dan tidak boleh diminta
//   /webhooks/ses     — SNS tidak dapat membawa kredensial kita
//
// Daftarnya ditulis sebagai awalan yang cocok PERSIS, bukan sebagai pola.
// Pola seperti `/unsubscribe*` akan ikut membuka `/unsubscribe-semua-kontak`
// kalau suatu saat ada rute bernama begitu — dan lubang otorisasi yang muncul
// dari kemiripan nama adalah lubang yang paling sulit terlihat saat membaca
// daftar rute.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { bacaSesi, type Pengguna } from "./repo.js";
import { bukaKonteks, jalankanDalam, tutupKonteks, type KonteksTenant } from "../db.js";
import { config } from "../config.js";

export const NAMA_COOKIE = "mb_sesi";

export interface Auth {
  pengguna: Pengguna;
  token: string;
  /** Pelanggan yang dilayani permintaan ini. `null` untuk superadmin murni. */
  tenantId: string | null;
  /** `true` hanya untuk superadmin yang TIDAK sedang berimpersonasi. */
  superadmin: boolean;
  impersonasi: { tenantId: string; nama: string | null; slug: string | null } | null;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: Auth | null;
    konteksIkatan?: ReturnType<typeof bukaKonteks>;
  }
}

const PUBLIK_PERSIS = new Set(["/health"]);
const PUBLIK_AWALAN = ["/unsubscribe/", "/webhooks/ses", "/auth/login"];

/**
 * Cangkang frontend, hanya ketika proses ini memang menyajikannya
 * (`STATIC_DIR` terisi — lihat config.ts).
 *
 * Keduanya WAJIB terbuka tanpa sesi: layar masuk ada di dalam berkas-berkas
 * ini, dan layar masuk yang menuntut sesi tidak dapat dibuka siapa pun.
 *
 * Yang terbuka hanya cangkangnya — HTML, JS, CSS yang sama untuk setiap
 * pengunjung. Seluruh data pelanggan tetap datang lewat rute di bawah, yang
 * tetap dijaga sepenuhnya.
 *
 * Dibuat bersyarat, bukan permanen: di pengembangan Vite yang menyajikan
 * frontend, dan tidak ada alasan `/` berhenti dijawab 401 di sana.
 */
const PUBLIK_STATIS_PERSIS = ["/", "/index.html"];
const PUBLIK_STATIS_AWALAN = ["/assets/"];

/**
 * Rute yang boleh diakses superadmin TANPA memilih pelanggan lebih dulu.
 * Semua rute lain adalah rute data pelanggan.
 */
const LINTAS_PELANGGAN = ["/admin/", "/auth/"];

function rutePublik(url: string): boolean {
  const path = url.split("?")[0];
  if (PUBLIK_PERSIS.has(path) || PUBLIK_AWALAN.some((a) => path.startsWith(a))) return true;

  if (!config.staticDir) return false;
  return (
    PUBLIK_STATIS_PERSIS.includes(path) || PUBLIK_STATIS_AWALAN.some((a) => path.startsWith(a))
  );
}

/** Pembaca cookie sederhana. Satu nilai yang dicari, tanpa dependensi baru. */
export function bacaCookie(header: string | undefined, nama: string): string | null {
  if (!header) return null;
  for (const bagian of header.split(";")) {
    const pisah = bagian.indexOf("=");
    if (pisah <= 0) continue;
    if (bagian.slice(0, pisah).trim() !== nama) continue;
    return decodeURIComponent(bagian.slice(pisah + 1).trim()) || null;
  }
  return null;
}

/**
 * `HttpOnly` supaya token tidak dapat dibaca JavaScript — satu skrip pihak
 * ketiga yang tersisip tidak lalu memegang sesi. `SameSite=Lax` menahan
 * pengiriman lintas situs pada permintaan berbahaya sambil membiarkan
 * navigasi biasa bekerja. `Secure` hanya di produksi: pengembangan berjalan di
 * http://localhost, dan cookie Secure tidak akan pernah terkirim di sana.
 */
export function cookieSesi(token: string, umurDetik: number): string {
  const bagian = [
    `${NAMA_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${umurDetik}`,
  ];
  if (config.env === "production") bagian.push("Secure");
  return bagian.join("; ");
}

export function cookieKosong(): string {
  return `${NAMA_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * Konteks basis data untuk satu sesi.
 *
 * Impersonasi menghasilkan konteks pelanggan BIASA — `superadmin: false`.
 * Itu inti dari fitur ini: superadmin yang masuk sebagai pelanggan harus
 * melihat persis apa yang dilihat pelanggan, termasuk batasnya. Membiarkan
 * bendera superadmin tetap menyala akan menampilkan data seluruh pelanggan
 * bercampur dalam satu daftar, dan itu bukan penelusuran masalah — itu
 * kebocoran yang diminta sendiri.
 */
export function konteksUntuk(auth: Auth): KonteksTenant {
  return { tenantId: auth.tenantId, superadmin: auth.superadmin };
}

export async function authPlugin(app: FastifyInstance) {
  app.decorateRequest("auth", null);

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (rutePublik(req.url)) return;

    const token = bacaCookie(req.headers.cookie, NAMA_COOKIE);
    if (!token) {
      return reply.code(401).send({ pesan: "belum masuk", kind: "tanpa_sesi" });
    }

    const sesi = await bacaSesi(token);
    if (!sesi) {
      // Cookie yang tidak lagi berlaku ikut dihapus di balasan. Tanpa itu,
      // peramban terus mengirimkannya dan setiap permintaan berikutnya
      // menghasilkan pencarian sesi yang sudah pasti gagal.
      return reply
        .code(401)
        .header("set-cookie", cookieKosong())
        .send({ pesan: "sesi tidak berlaku lagi", kind: "sesi_kedaluwarsa" });
    }

    const superadmin = sesi.pengguna.peran === "superadmin";
    const berimpersonasi = superadmin && sesi.impersonasi !== null;

    req.auth = {
      pengguna: sesi.pengguna,
      token,
      tenantId: berimpersonasi ? sesi.impersonasi : sesi.pengguna.tenant_id,
      superadmin: superadmin && !berimpersonasi,
      impersonasi: berimpersonasi
        ? {
            tenantId: sesi.impersonasi as string,
            nama: sesi.impersonasi_nama,
            slug: sesi.impersonasi_slug,
          }
        : null,
    };

    // Superadmin yang belum memilih pelanggan tidak boleh menyentuh rute data
    // pelanggan.
    //
    // Secara teknis ia bisa: konteksnya melewati RLS, jadi `GET /contacts`
    // akan menjawab 200 dengan kontak SELURUH pelanggan tergabung dalam satu
    // daftar. Justru itu masalahnya — angka gabungan yang tampil di layar
    // yang dirancang untuk satu pelanggan akan dibaca sebagai angka pelanggan
    // itu. "2.090 kontak" yang sebenarnya milik sembilan perusahaan adalah
    // dasar keputusan yang salah, dan tidak ada apa pun di tampilan yang
    // menunjukkannya.
    //
    // Karena itu jalannya dipersempit: kendali lintas pelanggan lewat
    // `/admin/*`, dan melihat data satu pelanggan lewat impersonasi — yang
    // tercatat di jejak audit. Pelewatan RLS jadi hanya dipakai query di
    // `routes/admin.ts`, yang menyebut `tenant_id` sendiri.
    const path = req.url.split("?")[0];
    if (req.auth.superadmin && !LINTAS_PELANGGAN.some((a) => path.startsWith(a))) {
      return reply.code(409).send({
        pesan:
          "Pilih pelanggan dulu. Kendali superadmin ada di /admin, dan untuk " +
          "melihat data pelanggan masuklah sebagai pelanggan itu.",
        kind: "pilih_pelanggan",
      });
    }
  });

  app.addHook("onRequest", (req, _reply, done) => {
    // Rute publik memasang konteksnya sendiri: keduanya menemukan pemiliknya
    // lewat token atau message_id lebih dulu, lalu membungkus pekerjaannya
    // dengan `dalamKonteks` (lihat routes/unsubscribe.ts).
    if (!req.auth) return done();

    const ikatan = bukaKonteks(konteksUntuk(req.auth));
    req.konteksIkatan = ikatan;
    jalankanDalam(ikatan, done);
  });

  app.addHook("onResponse", async (req) => {
    if (req.konteksIkatan) await tutupKonteks(req.konteksIkatan);
  });

  // Permintaan yang gagal di tengah jalan tetap harus mengembalikan
  // koneksinya. `onResponse` sudah menanganinya untuk balasan biasa; hook ini
  // menutup jalur di mana balasan tidak pernah terkirim.
  app.addHook("onRequestAbort", async (req) => {
    if (req.konteksIkatan) await tutupKonteks(req.konteksIkatan);
  });
}

/** Menolak permintaan yang bukan dari superadmin murni. */
export function wajibSuperadmin(req: FastifyRequest, reply: FastifyReply): boolean {
  const auth = req.auth;
  if (!auth || auth.pengguna.peran !== "superadmin") {
    // 404, bukan 403. Balasan 403 memberi tahu bahwa endpoint-nya ada —
    // informasi yang tidak perlu diketahui pengguna pelanggan.
    reply.code(404).send({ pesan: "tidak ditemukan" });
    return false;
  }
  if (auth.impersonasi) {
    reply.code(409).send({
      pesan:
        "sedang masuk sebagai pelanggan — keluar dari impersonasi dulu sebelum " +
        "memakai kendali superadmin",
      kind: "sedang_impersonasi",
    });
    return false;
  }
  return true;
}

/** Menolak permintaan dari peran yang tidak berhak mengelola akun. */
export function wajibAdminPelanggan(req: FastifyRequest, reply: FastifyReply): boolean {
  const peran = req.auth?.pengguna.peran;
  if (peran !== "admin" && peran !== "superadmin") {
    reply.code(403).send({ pesan: "hanya admin yang dapat melakukan ini", kind: "peran_kurang" });
    return false;
  }
  return true;
}
