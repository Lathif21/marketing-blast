// Rute integrasi Gmail.
//
// Alurnya sama seperti "masuk dengan GitHub" di Netlify:
//
//   1. POST /integrasi/gmail/mulai  → kita balas URL milik Google
//   2. pengguna memilih akun dan menyetujui izin DI HALAMAN GOOGLE
//   3. Google mengembalikannya ke /integrasi/gmail/callback membawa kode
//   4. kode ditukar menjadi token penyegar, disimpan terenkripsi
//
// Callback TIDAK publik, dan itu disengaja. Google mengembalikan pengguna
// lewat navigasi biasa di perambannya sendiri, jadi cookie sesi ikut terkirim
// (`SameSite=Lax` mengizinkan navigasi tingkat atas). Membuatnya publik berarti
// menerima kode dari siapa pun yang mengetahui URL-nya — dan `state` menjadi
// satu-satunya penjaga, padahal ia dirancang sebagai penjaga KEDUA.

import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import * as repo from "../gmail/repo.js";
import {
  GalatOAuth,
  SCOPES,
  bacaIdToken,
  bacaState,
  buatState,
  integrasiAktif,
  segarkanToken,
  tukarKode,
  urlIzin,
} from "../gmail/oauth.js";
import { GalatGmail, klienGoogle } from "../gmail/klien.js";
import { sinkronkan } from "../gmail/sinkron.js";
import { wajibAdminPelanggan } from "../auth/plugin.js";

/** Halaman kecil yang ditampilkan setelah pengguna kembali dari Google. */
function halaman(judul: string, isi: string, sukses: boolean): string {
  const warna = sukses ? "#2b7a5a" : "#8c2e2e";
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${judul}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         padding:24px; font:16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background:#f6f7f9; color:#1a2028; }
  .kartu { background:#fff; border:1px solid #e2e6ec; border-radius:6px; padding:32px; max-width:480px; width:100%; }
  .bar { height:3px; background:${warna}; border-radius:2px; margin-bottom:24px; }
  h1 { font-size:20px; margin:0 0 12px; }
  p { margin:0 0 12px; color:#4a5563; }
  a { color:#c4824a; }
  @media (prefers-color-scheme: dark) {
    body { background:#0d1520; color:#dce3ec; }
    .kartu { background:#141e2e; border-color:rgba(100,140,180,0.16); }
    p { color:#8da0b8; }
  }
</style>
</head>
<body><div class="kartu"><div class="bar"></div>${isi}</div></body>
</html>`;
}

const kembali = `<p><a href="/">Kembali ke Marketing Blast</a></p>`;

export async function gmailRoutes(app: FastifyInstance) {
  /** Daftar kotak masuk yang tersambung, beserta keadaan integrasinya. */
  app.get("/integrasi/gmail", async (req) => {
    return {
      aktif: integrasiAktif(),
      scopes: SCOPES,
      koneksi: req.auth ? await repo.daftar() : [],
      catatan: integrasiAktif()
        ? null
        : "Integrasi Gmail belum dikonfigurasi di server (GOOGLE_CLIENT_ID kosong).",
    };
  });

  app.post("/integrasi/gmail/mulai", async (req, reply) => {
    if (!wajibAdminPelanggan(req, reply)) return reply;

    // 503, bukan 500: ini keadaan yang memang bisa terjadi pada instalasi yang
    // sengaja tidak memakai integrasi ini, dan bukan kesalahan permintaan.
    if (!integrasiAktif()) {
      return reply.code(503).send({
        pesan: "Integrasi Gmail belum dikonfigurasi di server ini.",
        kind: "gmail_mati",
      });
    }

    const auth = req.auth!;
    if (!auth.tenantId) {
      return reply.code(409).send({
        pesan: "Pilih pelanggan dulu sebelum menyambungkan kotak masuk.",
        kind: "pilih_pelanggan",
      });
    }

    const state = buatState(auth.tenantId, auth.pengguna.id);
    return { url: urlIzin(state, auth.pengguna.email) };
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/integrasi/gmail/callback",
    async (req, reply) => {
      const html = (judul: string, isi: string, sukses: boolean, kode = 200) =>
        reply.code(kode).type("text/html; charset=utf-8").send(halaman(judul, isi, sukses));

      // Pengguna menekan "Batal" di halaman Google. Bukan galat.
      if (req.query.error) {
        return html(
          "Penyambungan dibatalkan",
          `<h1>Penyambungan dibatalkan</h1>
           <p>Tidak ada yang berubah, dan tidak ada akses yang diberikan ke kotak masuk Anda.</p>${kembali}`,
          false,
        );
      }

      const { code, state } = req.query;
      if (!code || !state) {
        return html("Permintaan tidak lengkap", `<h1>Permintaan tidak lengkap</h1>${kembali}`, false, 400);
      }

      const asal = bacaState(state);
      const auth = req.auth;

      // Penjagaan inti: `state` harus berasal dari sesi INI, untuk pelanggan
      // yang sedang dibuka sesi ini. Tanpa pemeriksaan ini, seseorang dapat
      // memancing korban membuka URL callback berisi kode milik akun Google
      // PENYERANG — dan kotak masuk penyerang tersambung ke pelanggan korban.
      if (!asal || !auth || asal.tenantId !== auth.tenantId || asal.userId !== auth.pengguna.id) {
        req.log.warn({ ip: req.ip }, "callback Gmail dengan state yang tidak cocok");
        return html(
          "Tautan tidak berlaku",
          `<h1>Tautan tidak berlaku</h1>
           <p>Mulai penyambungan dari dalam aplikasi, bukan dari tautan yang disalin.</p>${kembali}`,
          false,
          403,
        );
      }

      try {
        const token = await tukarKode(code);

        // Tanpa refresh token, koneksinya hanya hidup satu jam lalu mati tanpa
        // jalan pulih. Lebih baik gagal sekarang, dengan sebab yang jelas.
        if (!token.refreshToken) {
          return html(
            "Google tidak mengirim token penyegar",
            `<h1>Google tidak mengirim token penyegar</h1>
             <p>Cabut akses Marketing Blast di
                <a href="https://myaccount.google.com/permissions">akun Google Anda</a>,
                lalu sambungkan lagi dari awal.</p>${kembali}`,
            false,
            502,
          );
        }

        const identitas = token.idToken ? bacaIdToken(token.idToken) : null;
        if (!identitas) {
          return html("Identitas akun tidak terbaca", `<h1>Identitas akun tidak terbaca</h1>${kembali}`, false, 502);
        }

        const koneksi = await repo.simpan({
          email: identitas.email,
          googleSub: identitas.sub,
          refreshToken: token.refreshToken,
          scopes: token.scope,
          oleh: auth.pengguna.email,
        });

        req.log.info({ email: identitas.email, oleh: auth.pengguna.email }, "Gmail tersambung");

        return html(
          "Kotak masuk tersambung",
          `<h1>Kotak masuk tersambung</h1>
           <p><strong>${koneksi.email}</strong> tersambung. Balasan kampanye akan tercatat
              sendiri, dan alamat yang pernah berkorespondensi dua arah dengan Anda akan
              muncul sebagai kontak.</p>
           <p>Sinkronisasi pertama berjalan dalam beberapa menit.</p>${kembali}`,
          true,
        );
      } catch (err) {
        const pesan = err instanceof Error ? err.message : String(err);
        req.log.error({ err }, "penukaran kode Gmail gagal");
        return html(
          "Penyambungan gagal",
          `<h1>Penyambungan gagal</h1><p>${pesan.replace(/[<>]/g, "")}</p>${kembali}`,
          false,
          502,
        );
      }
    },
  );

  /** Sinkronisasi atas permintaan, tanpa menunggu putaran terjadwal. */
  app.post<{ Params: { id: string } }>("/integrasi/gmail/:id/sinkron", async (req, reply) => {
    if (!wajibAdminPelanggan(req, reply)) return reply;

    const koneksi = await repo.ambil(req.params.id);
    if (!koneksi) return reply.code(404).send({ pesan: "koneksi tidak ditemukan" });
    if (koneksi.status !== "aktif") {
      return reply.code(409).send({
        pesan: "Koneksi ini perlu disambungkan ulang.",
        kind: "perlu_sambung_ulang",
      });
    }

    const penyegar = await repo.tokenPenyegar(koneksi.id);
    if (!penyegar) {
      await repo.catatGalat(koneksi.id, "token penyegar tidak dapat dibaca", true);
      return reply.code(409).send({
        pesan: "Token akses tidak dapat dibaca. Sambungkan ulang kotak masuk ini.",
        kind: "perlu_sambung_ulang",
      });
    }

    try {
      const token = await segarkanToken(penyegar);
      const hasil = await sinkronkan(koneksi, klienGoogle(token.accessToken));
      await repo.catatSinkron(koneksi.id, {
        sampai: hasil.sampai,
        balasan: hasil.balasan,
        kontak: hasil.kontakBaru,
      });
      return hasil;
    } catch (err) {
      const perlu =
        (err instanceof GalatOAuth && err.perluSambungUlang) ||
        (err instanceof GalatGmail && err.perluSambungUlang);
      const pesan = err instanceof Error ? err.message : String(err);
      await repo.catatGalat(koneksi.id, pesan, perlu);

      return reply.code(perlu ? 409 : 502).send({
        pesan: perlu
          ? "Izin Gmail sudah tidak berlaku. Sambungkan ulang kotak masuk ini."
          : `Sinkronisasi gagal: ${pesan}`,
        kind: perlu ? "perlu_sambung_ulang" : "sinkron_gagal",
      });
    }
  });

  app.post<{ Params: { id: string } }>("/integrasi/gmail/:id/putus", async (req, reply) => {
    if (!wajibAdminPelanggan(req, reply)) return reply;

    const berhasil = await repo.putus(req.params.id);
    if (!berhasil) return reply.code(404).send({ pesan: "koneksi tidak ditemukan" });

    req.log.info({ id: req.params.id, oleh: req.auth!.pengguna.email }, "Gmail diputus");
    return {
      diputus: true,
      catatan:
        "Akses dari sisi kami dicabut. Untuk mencabutnya juga dari akun Google Anda, " +
        "buka myaccount.google.com/permissions.",
    };
  });

  /** Dipakai UI menampilkan konfigurasi tanpa menebak. */
  app.get("/integrasi/gmail/konfigurasi", async () => ({
    aktif: integrasiAktif(),
    redirect_uri: config.google.redirectUri || null,
    scopes: SCOPES,
  }));
}
