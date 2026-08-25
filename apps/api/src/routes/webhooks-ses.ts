// Penerima notifikasi pemantulan dan keluhan dari SES lewat SNS.
//
// Boleh ditulis sekarang meski SES belum aktif: bentuk payload SNS sudah
// terdokumentasi, jadi bisa diuji dengan payload tiruan.
//
// Endpoint ini publik dan menulis ke daftar yang tidak punya operasi hapus.
// Verifikasi tanda tangan wajib ada sejak awal, bukan ditambahkan nanti.

import type { FastifyInstance } from "fastify";
import { verifySnsMessage, isAllowedSnsUrl, type SnsMessage } from "../lib/sns.js";
import { suppressByEmail } from "../suppression/repo.js";
import { extractSuppressions, type SesNotification } from "../suppression/ses-events.js";

interface Handled {
  suppressed: string[];
  ignored: string[];
}


export async function sesWebhookRoutes(app: FastifyInstance) {
  app.post("/webhooks/ses", async (req, reply) => {
    // SNS mengirim body sebagai text/plain, jadi Fastify tidak selalu
    // menguraikannya sebagai JSON.
    let message: SnsMessage;
    try {
      message = typeof req.body === "string" ? JSON.parse(req.body) : (req.body as SnsMessage);
    } catch {
      return reply.code(400).send({ error: "body bukan JSON" });
    }

    if (!message || typeof message !== "object" || !message.Type) {
      return reply.code(400).send({ error: "bukan pesan SNS" });
    }

    const verification = await verifySnsMessage(message);
    if (!verification.ok) {
      // 403, bukan 400: ini penolakan otorisasi, dan dicatat supaya percobaan
      // berulang terlihat.
      req.log.warn({ reason: verification.reason, topic: message.TopicArn }, "pesan SNS ditolak");
      return reply.code(403).send({ error: "tanda tangan tidak sah" });
    }

    if (message.Type === "SubscriptionConfirmation") {
      // Tanpa langkah ini status langganan tetap PendingConfirmation dan tidak
      // ada satu pun event yang masuk.
      const url = message.SubscribeURL;
      if (!url || !isAllowedSnsUrl(url)) {
        req.log.warn({ url }, "SubscribeURL bukan host SNS AWS");
        return reply.code(403).send({ error: "SubscribeURL tidak sah" });
      }
      const res = await fetch(url);
      req.log.info({ status: res.status }, "langganan SNS dikonfirmasi");
      return reply.code(200).send({ confirmed: res.ok });
    }

    if (message.Type !== "Notification") {
      req.log.info({ type: message.Type }, "pesan SNS diabaikan");
      return reply.code(200).send({ ignored: true });
    }

    let notification: SesNotification;
    try {
      notification = JSON.parse(message.Message);
    } catch {
      return reply.code(400).send({ error: "Message bukan JSON" });
    }

    const result: Handled = { suppressed: [], ignored: [] };
    for (const { email, reason } of extractSuppressions(notification)) {
      await suppressByEmail(email, reason);
      result.suppressed.push(email);
    }

    if (result.suppressed.length === 0) {
      result.ignored.push(notification.notificationType ?? notification.eventType ?? "unknown");
    }

    req.log.info(result, "notifikasi SES diproses");
    return reply.code(200).send(result);
  });
}
