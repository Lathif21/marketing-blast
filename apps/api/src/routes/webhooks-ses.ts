// Penerima notifikasi pemantulan dan keluhan dari SES lewat SNS.
//
// Boleh ditulis sekarang meski SES belum aktif: bentuk payload SNS sudah
// terdokumentasi, jadi bisa diuji dengan payload tiruan.
//
// Endpoint ini publik dan menulis ke daftar yang tidak punya operasi hapus.
// Verifikasi tanda tangan wajib ada sejak awal, bukan ditambahkan nanti.

import type { FastifyInstance } from "fastify";
import { verifySnsMessage, isAllowedSnsUrl, type SnsMessage } from "../lib/sns.js";
import { suppressByEmail, tenantDariNotifikasi } from "../suppression/repo.js";
import { dalamKonteks } from "../db.js";
import {
  extractEngagement,
  extractReply,
  extractSuppressions,
  type SesNotification,
} from "../suppression/ses-events.js";
import { catatBalasan, catatEvent } from "../campaign/repo.js";

interface Handled {
  suppressed: string[];
  /** Event keterlibatan yang tercatat, misalnya `open` atau `click`. */
  tercatat: string[];
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

    const result: Handled = { suppressed: [], tercatat: [], ignored: [] };

    // Pemilik ditentukan SEBELUM apa pun ditulis.
    //
    // Daftar penekanan sekarang per pelanggan (migrasi 010), jadi "alamat ini
    // memantul keras" tidak lengkap tanpa "milik pelanggan mana". Notifikasi
    // yang tidak dapat ditautkan ke satu pengiriman pun dicatat sebagai
    // peringatan dan tidak ditulis ke mana-mana: menebak pemiliknya berarti
    // menekan alamat pada pelanggan yang keliru, dan daftar penekanan tidak
    // punya operasi hapus untuk membatalkannya.
    const balasanAwal = extractReply(notification);
    const tenantId = await tenantDariNotifikasi({
      messageId: notification.mail?.messageId ?? balasanAwal?.inReplyTo ?? null,
      email: balasanAwal?.email ?? null,
    });

    if (!tenantId) {
      req.log.warn(
        { messageId: notification.mail?.messageId, tipe: notification.notificationType },
        "notifikasi SES tidak dapat ditautkan ke pelanggan mana pun — tidak diproses",
      );
      return reply.code(202).send({ diabaikan: "pemilik tidak dikenali" });
    }

    return dalamKonteks({ tenantId }, async () => {
      for (const { email, reason } of extractSuppressions(notification)) {
        await suppressByEmail(email, reason);
        result.suppressed.push(email);
      }

      // Buka dan klik dicatat di sini, bukan lewat pelacak sendiri. Inilah yang
      // mengisi `opened_at` dan `clicked_at` — dua kolom yang menentukan siapa
      // yang masuk kampanye tindak lanjut dan siapa yang akhirnya dinilai diam.
      const event = extractEngagement(notification);
      if (event && (await catatEvent(event.messageId, event.jenis))) {
        result.tercatat.push(event.jenis);
      }

      // Balasan: sinyal ketertarikan terkuat, dan satu-satunya yang datang lewat
      // surat masuk alih-alih lewat event pengiriman.
      const balasan = balasanAwal;
      if (balasan) {
        const tertaut = await catatBalasan({
          messageId: balasan.inReplyTo,
          email: balasan.email,
          cuplikan: balasan.subject,
        });
        if (tertaut) result.tercatat.push("reply");
        else {
          req.log.info({ email: balasan.email }, "balasan tidak tertaut ke pengiriman mana pun");
        }
      }

      if (result.suppressed.length === 0 && result.tercatat.length === 0) {
        result.ignored.push(notification.notificationType ?? notification.eventType ?? "unknown");
      }

      req.log.info({ ...result, tenant: tenantId }, "notifikasi SES diproses");
      return reply.code(200).send(result);
    });
  });
}
