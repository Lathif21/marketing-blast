// Token berhenti berlangganan.
//
// Bentuknya `<contact_id>.<hmac>`, bukan angka berurutan atau UUID mentah.
// UUID mentah memang sulit ditebak, tapi ia juga menjadi pengenal internal
// yang bocor ke luar; HMAC memisahkan keduanya dan membuat token yang diubah
// sedikit pun langsung tidak berlaku.
//
// Token tidak kedaluwarsa. Tautan berhenti berlangganan di email lama harus
// tetap bekerja bertahun-tahun kemudian — kalau tidak, penerima yang ingin
// keluar akan menandai spam sebagai gantinya.

import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

function sign(contactId: string): string {
  return createHmac("sha256", config.unsubscribeSecret)
    .update(contactId)
    .digest("base64url");
}

export function createUnsubscribeToken(contactId: string): string {
  return `${contactId}.${sign(contactId)}`;
}

/** Mengembalikan `contact_id` bila token sah, `null` bila tidak. */
export function verifyUnsubscribeToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;

  const contactId = token.slice(0, dot);
  const provided = token.slice(dot + 1);

  // Pengenal kontak selalu UUID. Menolaknya lebih awal menjaga query di
  // hilir tidak pernah menerima bentuk yang tidak diharapkan.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contactId)) {
    return null;
  }

  const expected = sign(contactId);

  // Panjang harus dibandingkan lebih dulu: timingSafeEqual melempar kalau
  // panjangnya beda, dan lemparan itu sendiri membocorkan informasi.
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return null;

  return timingSafeEqual(a, b) ? contactId : null;
}

export function unsubscribeUrl(contactId: string): string {
  return `${config.publicBaseUrl}/unsubscribe/${createUnsubscribeToken(contactId)}`;
}
