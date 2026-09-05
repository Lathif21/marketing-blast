// API. Endpoint mengikuti daftar di 01-arsitektur.md.
//
// Dua rute sengaja berada di luar autentikasi apa pun:
//   /unsubscribe/:token — penerima tidak punya akun, dan tidak boleh diminta
//   /webhooks/ses       — SNS tidak bisa membawa kredensial kita
// Keduanya mengamankan diri sendiri: token HMAC dan tanda tangan SNS.

import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { config, validateConfig } from "./config.js";
import { close, ping } from "./db.js";
import { mailDriver } from "./mail/index.js";
import { authPlugin } from "./auth/plugin.js";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { campaignRoutes } from "./routes/campaigns.js";
import { contactRoutes } from "./routes/contacts.js";
import { domainRoutes } from "./routes/domain.js";
import { importRoutes } from "./routes/imports.js";
import { suppressionRoutes } from "./routes/suppression.js";
import { unsubscribeRoutes } from "./routes/unsubscribe.js";
import { sesWebhookRoutes } from "./routes/webhooks-ses.js";

const app = Fastify({
  logger: { level: config.env === "production" ? "info" : "debug" },
  bodyLimit: 30 * 1024 * 1024,
});

await app.register(multipart, {
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  attachFieldsToBody: false,
});

// Body JSON kosong diperlakukan sebagai "tidak ada body", bukan sebagai galat.
//
// Bawaan Fastify menolaknya dengan 400 "Body cannot be empty when content-type
// is set to 'application/json'". Itu keliru untuk endpoint yang memang tidak
// butuh body — commit dan pembatalan impor — dan menghasilkan pesan yang tidak
// menjelaskan apa pun ke pengguna.
//
// Endpoint yang benar-benar butuh isi tetap aman: field yang hilang divalidasi
// per rute dan dibalas 422 beserta alasannya, yang jauh lebih berguna daripada
// 400 tanpa konteks.
app.removeContentTypeParser("application/json");
app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (_req, body, done) => {
    const teks = (body as string).trim();
    if (teks === "") return done(null, undefined);
    try {
      done(null, JSON.parse(teks));
    } catch {
      const err = new Error("Body bukan JSON yang sah") as Error & { statusCode?: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  },
);

// SNS mengirim notifikasi dengan Content-Type text/plain. Tanpa parser ini
// Fastify menolak body-nya sebelum verifikasi tanda tangan sempat berjalan.
app.addContentTypeParser("text/plain", { parseAs: "string" }, (_req, body, done) => {
  done(null, body);
});

// Berhenti berlangganan satu klik (RFC 8058) datang sebagai POST dengan body
// `List-Unsubscribe=One-Click` ber-Content-Type form-urlencoded. Isinya tidak
// kita butuhkan — yang penting Fastify tidak menolaknya dengan 415 sebelum
// rute sempat berjalan. Klien email tidak akan mencoba ulang.
app.addContentTypeParser(
  "application/x-www-form-urlencoded",
  { parseAs: "string" },
  (_req, body, done) => {
    done(null, body);
  },
);

app.get("/health", async (_req, reply) => {
  const mail = mailDriver();
  // Keadaan dummy sengaja ikut dilaporkan. Sistem yang terlihat sehat tapi
  // tidak benar-benar mengirim adalah kekeliruan yang mahal kalau baru
  // ketahuan setelah kampanye pertama dianggap terkirim.
  const mailStatus = {
    driver: mail.name,
    sends_real_email: mail.sendsRealEmail,
    sender_domain: config.sender.domain,
  };

  try {
    await ping();
    return { status: "ok", database: "ok", mail: mailStatus };
  } catch (err) {
    app.log.error({ err }, "healthcheck basis data gagal");
    return reply
      .code(503)
      .send({ status: "degraded", database: "unreachable", mail: mailStatus });
  }
});

// Autentikasi dipasang LANGSUNG pada instance akar, bukan lewat `register`.
//
// Ini bukan selera gaya. `register` membuat lingkup terenkapsulasi: hook yang
// ditambahkan di dalamnya hanya berlaku untuk rute yang didaftarkan di lingkup
// itu dan turunannya — TIDAK untuk plugin bersaudara. Dipasang lewat
// `register`, hook autentikasi tidak pernah berjalan untuk `/contacts`,
// `/campaigns`, dan seluruh rute lain di bawah ini.
//
// Kegagalannya sudah terjadi sekali saat fitur ini dibangun, dan bentuknya
// pantas dicatat: permintaan tanpa sesi TIDAK dibalas 401 — ia lolos ke
// handler, lalu gagal 500 karena `query()` menolak bekerja tanpa konteks
// tenant. Yang menyelamatkan keadaan itu adalah penjagaan di lapisan basis
// data, bukan pemeriksaan sesi di sini. Kalau `query()` dulu dibuat "jatuh
// kembali ke pool" alih-alih melempar, setiap rute data pelanggan akan
// terbuka tanpa autentikasi dan balasannya 200 — tanpa satu pun galat yang
// menunjukkannya.
//
// Dipasang sebelum rute mana pun karena hook hanya berlaku untuk rute yang
// didaftarkan sesudahnya. Daftar rute publik ada di auth/plugin.ts.
await authPlugin(app);
await app.register(authRoutes);
await app.register(adminRoutes);

await app.register(unsubscribeRoutes);
await app.register(sesWebhookRoutes);
await app.register(suppressionRoutes);
await app.register(campaignRoutes);
await app.register(contactRoutes);
await app.register(domainRoutes);
await app.register(importRoutes);

async function start() {
  try {
    validateConfig();
  } catch (err) {
    app.log.error({ err }, "konfigurasi tidak valid");
    process.exit(1);
  }

  if (config.db.usingAdminForApp) {
    app.log.warn(
      "APP_DATABASE_URL kosong — aplikasi terhubung sebagai pemilik skema. " +
        "Larangan DELETE pada tabel suppression TIDAK aktif dalam keadaan ini.",
    );
  }

  const mail = mailDriver();
  if (!mail.sendsRealEmail) {
    app.log.warn(
      `driver email "${mail.name}" tidak mengirim ke internet — ` +
        `pengiriman sungguhan butuh MAIL_DRIVER=ses (docs/08-amazon-ses.md)`,
    );
  }

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error({ err }, "server gagal start");
    process.exit(1);
  }
}

async function shutdown(signal: string) {
  app.log.info({ signal }, "shutdown");
  await app.close();
  await close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

void start();

export { app };
