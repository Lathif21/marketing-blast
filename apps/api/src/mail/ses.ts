// Driver Amazon SES — kerangka, belum diimplementasikan.
//
// Pengisiannya dijadwalkan Fase 2 (06-rencana-build.md). Yang sudah tetap di
// sini adalah bentuk antarmukanya dan prasyarat yang harus dipenuhi sebelum
// baris pertama pengiriman ditulis. Langkah pembuatan akun, verifikasi domain,
// dan keluar dari sandbox ada di docs/08-amazon-ses.md.
//
// Sengaja melempar, bukan diam-diam tidak mengirim: kalau seseorang menyetel
// MAIL_DRIVER=ses sebelum driver ini siap, kegagalannya harus terlihat.

import { config } from "../config.js";
import type { MailDriver, OutboundMessage, SendResult } from "./types.js";

export function createSesDriver(): MailDriver {
  return {
    name: "ses",
    sendsRealEmail: true,

    async send(_message: OutboundMessage): Promise<SendResult> {
      throw new Error(
        "Driver SES belum diimplementasikan (dijadwalkan Fase 2). " +
          `Region terkonfigurasi: ${config.ses.region}, ` +
          `configuration set: ${config.ses.configurationSet}. ` +
          "Sementara ini pakai MAIL_DRIVER=dummy. Lihat docs/08-amazon-ses.md.",
      );
    },
  };
}

/**
 * Yang harus sudah benar sebelum driver ini dinyalakan. Dipakai dokumentasi
 * dan, nanti, oleh pemeriksaan pra-kirim.
 */
export const SES_PREREQUISITES = [
  "Identitas domain terverifikasi di SES",
  "Tiga record CNAME DKIM terpasang dan berstatus verified",
  "MAIL FROM kustom terkonfigurasi (MX + SPF)",
  "DMARC terpasang, minimal p=none, dan laporannya sudah masuk",
  "Akun keluar dari sandbox SES",
  "Configuration set meneruskan event bounce dan keluhan ke webhook",
  "Jalur berhenti berlangganan dan pemantulan terbukti bekerja pada daftar sendiri",
] as const;
