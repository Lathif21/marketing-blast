// Kerangka API. Fase 0 hanya menyiapkan proses yang bisa dijalankan Docker
// Compose dan dicek sehat. Endpoint sebenarnya ditulis mulai Fase 1 —
// daftarnya ada di 01-arsitektur.md.

import Fastify from "fastify";
import { config, validateConfig } from "./config.js";
import { close, ping } from "./db.js";
import { mailDriver } from "./mail/index.js";

const app = Fastify({
  logger: { level: config.env === "production" ? "info" : "debug" },
});

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

async function start() {
  try {
    validateConfig();
  } catch (err) {
    app.log.error({ err }, "konfigurasi tidak valid");
    process.exit(1);
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
