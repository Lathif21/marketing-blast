// Pemetaan notifikasi SES menjadi entri daftar penekanan.
//
// Murni: tidak menyentuh basis data, tidak membaca konfigurasi. Ini aturan
// yang paling mahal kalau salah — alamat yang terlanjur masuk daftar tidak
// dapat dikeluarkan — jadi ia harus dapat diuji sendirian.

export interface SesNotification {
  notificationType?: string;
  /** Bentuk yang dipakai event destination pada configuration set. */
  eventType?: string;
  mail?: { messageId?: string; destination?: string[] };
  bounce?: {
    bounceType?: string;
    bounceSubType?: string;
    bouncedRecipients?: { emailAddress?: string }[];
  };
  complaint?: {
    complainedRecipients?: { emailAddress?: string }[];
  };
}

export type SuppressionReason = "unsubscribe" | "hard_bounce" | "keluhan" | "manual";

export interface Suppressed {
  email: string;
  reason: SuppressionReason;
}

/**
 * Hanya pemantulan KERAS yang masuk daftar penekanan. Pemantulan sementara
 * (mailbox penuh, server sibuk) tidak — alamatnya masih sah, dan menekannya
 * berarti kehilangan kontak valid secara permanen karena daftar ini tidak
 * punya operasi hapus.
 */
export function extractSuppressions(notification: SesNotification): Suppressed[] {
  const type = notification.notificationType ?? notification.eventType;

  if (type === "Bounce") {
    const bounce = notification.bounce;
    if (bounce?.bounceType !== "Permanent") return [];
    return (bounce.bouncedRecipients ?? [])
      .map((r) => r.emailAddress)
      .filter((e): e is string => Boolean(e))
      .map((email) => ({ email, reason: "hard_bounce" as const }));
  }

  if (type === "Complaint") {
    return (notification.complaint?.complainedRecipients ?? [])
      .map((r) => r.emailAddress)
      .filter((e): e is string => Boolean(e))
      .map((email) => ({ email, reason: "keluhan" as const }));
  }

  return [];
}
