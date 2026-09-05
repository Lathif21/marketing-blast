// Pemetaan notifikasi SES menjadi entri daftar penekanan.
//
// Murni: tidak menyentuh basis data, tidak membaca konfigurasi. Ini aturan
// yang paling mahal kalau salah — alamat yang terlanjur masuk daftar tidak
// dapat dikeluarkan — jadi ia harus dapat diuji sendirian.

export interface SesNotification {
  notificationType?: string;
  /** Bentuk yang dipakai event destination pada configuration set. */
  eventType?: string;
  mail?: {
    messageId?: string;
    destination?: string[];
    commonHeaders?: { from?: string[]; subject?: string; messageId?: string };
    headers?: { name?: string; value?: string }[];
  };
  bounce?: {
    bounceType?: string;
    bounceSubType?: string;
    bouncedRecipients?: { emailAddress?: string }[];
  };
  complaint?: {
    complainedRecipients?: { emailAddress?: string }[];
  };
  /** Hanya ada pada notifikasi Delivery, Open, dan Click. */
  delivery?: { timestamp?: string };
  open?: { timestamp?: string };
  click?: { link?: string };
  /** Ada pada notifikasi surat masuk (SES receipt rule). */
  receipt?: { recipients?: string[] };
  content?: string;
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

// ── Keterlibatan penerima ────────────────────────────────────────────────────
//
// Terpisah dari `extractSuppressions` karena akibatnya berbeda jauh. Salah
// menekan alamat tidak dapat dibatalkan; salah mencatat sebuah buka hanya
// menggeser angka funnel. Menggabungkan keduanya dalam satu fungsi membuat
// perubahan pada yang murah ikut menyentuh jalur yang mahal.
//
// Tanpa jalur ini, `opened_at` dan `clicked_at` tidak pernah terisi — dan
// seluruh gagasan "tindak lanjuti yang tertarik, hiraukan yang diam" berdiri
// di atas kolom yang selalu kosong. Kampanye lanjutan tidak akan pernah punya
// penerima, dan setiap kontak pada akhirnya dinilai `diam`.

export type JenisEvent = "delivery" | "open" | "click";

export interface EventKeterlibatan {
  messageId: string;
  jenis: JenisEvent;
}

const JENIS: Record<string, JenisEvent> = {
  Delivery: "delivery",
  Open: "open",
  Click: "click",
};

/**
 * `null` bila notifikasinya bukan salah satu dari ketiganya — termasuk untuk
 * `Send`, `Reject`, dan `DeliveryDelay`, yang memang tidak menyatakan apa pun
 * tentang ketertarikan penerima.
 */
export function extractEngagement(notification: SesNotification): EventKeterlibatan | null {
  const type = notification.notificationType ?? notification.eventType;
  const jenis = type ? JENIS[type] : undefined;
  if (!jenis) return null;

  const messageId = notification.mail?.messageId;
  // Tanpa messageId tidak ada baris yang dapat ditautkan. Dibuang di sini
  // supaya pemanggil tidak perlu menjaga kemungkinan itu.
  if (!messageId) return null;

  return { messageId, jenis };
}

// ── Balasan masuk ────────────────────────────────────────────────────────────

export interface BalasanMasuk {
  /** Alamat pembalas, sudah diambil dari bentuk `Nama <alamat>`. */
  email: string;
  /** `Message-ID` pesan yang dibalas. Menunjuk tepat ke satu pengiriman. */
  inReplyTo: string | null;
  subject: string | null;
}

function headerValue(notification: SesNotification, nama: string): string | null {
  const cocok = (notification.mail?.headers ?? []).find(
    (h) => h.name?.toLowerCase() === nama.toLowerCase(),
  );
  return cocok?.value?.trim() || null;
}

/** `Nama Lengkap <orang@contoh.id>` → `orang@contoh.id`. */
export function alamatDari(raw: string): string | null {
  const kurung = raw.match(/<([^>]+)>/);
  const calon = (kurung ? kurung[1] : raw).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(calon) ? calon.toLowerCase() : null;
}

/** `<abc@ses>` → `abc@ses`. Beberapa klien email membawa lebih dari satu. */
function messageIdBersih(raw: string | null): string | null {
  if (!raw) return null;
  const pertama = raw.split(/\s+/)[0]?.trim();
  if (!pertama) return null;
  return pertama.replace(/^</, "").replace(/>$/, "") || null;
}

/**
 * Membaca notifikasi surat masuk SES sebagai balasan.
 *
 * `In-Reply-To` diutamakan, dengan `References` sebagai cadangan: sebagian
 * klien email hanya mengisi yang kedua. Bila keduanya kosong, yang tersisa
 * hanyalah alamat pengirim — cukup untuk menautkan ke pengiriman terakhir
 * kepadanya, dan itu memang yang dilakukan `catatBalasan`.
 *
 * Balasan otomatis TIDAK disaring di sini. Alasannya: "Out of Office" bukan
 * tanda ketertarikan, tapi menebaknya dari subjek berarti menebak dalam
 * beberapa bahasa sekaligus dan tetap meleset. Yang menahannya adalah jeda
 * tindak lanjut — pesan berikutnya tidak keluar dalam hitungan detik, dan
 * balasan otomatis yang terlanjur tercatat masih dapat dibersihkan orang
 * sebelum kampanye lanjutannya berjalan.
 */
export function extractReply(notification: SesNotification): BalasanMasuk | null {
  const type = notification.notificationType ?? notification.eventType;
  if (type !== "Received") return null;

  const dari =
    notification.mail?.commonHeaders?.from?.[0] ?? headerValue(notification, "From");
  const email = dari ? alamatDari(dari) : null;
  if (!email) return null;

  return {
    email,
    inReplyTo:
      messageIdBersih(headerValue(notification, "In-Reply-To")) ??
      messageIdBersih(headerValue(notification, "References")),
    subject: notification.mail?.commonHeaders?.subject ?? null,
  };
}
