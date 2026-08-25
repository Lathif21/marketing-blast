// Driver yang tidak mengirim apa pun.
//
// Dipakai selama domain pengirim dan akun SES belum ada. Setiap pesan ditulis
// sebagai berkas .eml supaya bisa dibuka dan diperiksa isinya — termasuk
// memastikan identitas pengirim dan tautan berhenti berlangganan benar-benar
// tersisip sebelum ada satu pun email sungguhan yang keluar.

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import type { MailDriver, OutboundMessage, SendResult } from "./types.js";

function toEml(message: OutboundMessage, messageId: string): string {
  const unsubscribeUrl = `https://${config.sender.domain}/unsubscribe/${message.unsubscribeToken}`;
  const headers = [
    `Message-ID: <${messageId}@${config.sender.domain}>`,
    `Date: ${new Date().toUTCString()}`,
    `From: ${config.sender.name} <${config.sender.address}>`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    // RFC 8058: berhenti berlangganan satu klik, tanpa autentikasi.
    `List-Unsubscribe: <${unsubscribeUrl}>`,
    `List-Unsubscribe-Post: List-Unsubscribe=One-Click`,
    `X-Campaign-ID: ${message.campaignId}`,
    `Content-Type: text/plain; charset=utf-8`,
  ];
  return `${headers.join("\r\n")}\r\n\r\n${message.textBody}\r\n`;
}

export function createDummyDriver(): MailDriver {
  let warned = false;

  return {
    name: "dummy",
    sendsRealEmail: false,

    async send(message: OutboundMessage): Promise<SendResult> {
      if (!warned) {
        warned = true;
        console.warn(
          "[mail] driver dummy aktif — tidak ada email yang benar-benar dikirim. " +
            "Untuk mengirim sungguhan, lihat docs/08-amazon-ses.md.",
        );
      }

      const messageId = `dummy-${randomUUID()}`;

      try {
        await mkdir(config.mail.outboxDir, { recursive: true });
        await writeFile(
          join(config.mail.outboxDir, `${messageId}.eml`),
          toEml(message, messageId),
          "utf8",
        );
      } catch (err) {
        // Gagal menulis salinan tidak boleh menghentikan alur pengembangan.
        console.warn("[mail] gagal menulis salinan pesan ke outbox", err);
      }

      console.info(`[mail] dummy → ${message.to} · ${message.subject}`);
      return { messageId, delivered: false };
    },
  };
}
