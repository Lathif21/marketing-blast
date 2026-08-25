// Konfigurasi dibaca satu kali saat start. Variabel yang hilang membuat proses
// berhenti di awal, bukan gagal diam-diam saat pengiriman pertama.
//
// Selama domain pengirim dan akun SES belum ada, seluruh nilai di bawah boleh
// berisi dummy dan `MAIL_DRIVER=dummy` menahan semua pengiriman keluar.
// Cara menggantinya dengan nilai sungguhan: docs/07-domain-dan-dns.md dan
// docs/08-amazon-ses.md.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variabel lingkungan ${name} wajib diisi. Lihat .env.example.`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function list(name: string): string[] {
  return optional(name, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * `dummy` menahan seluruh email di dalam sistem dan hanya mencatatnya.
 * `ses` benar-benar mengirim lewat Amazon SES.
 *
 * Bawaannya sengaja `dummy`: salah konfigurasi harus berakhir pada tidak ada
 * email terkirim, bukan pada email terkirim ke alamat sungguhan.
 */
export type MailDriver = "dummy" | "ses";

function mailDriver(): MailDriver {
  const value = optional("MAIL_DRIVER", "dummy");
  if (value !== "dummy" && value !== "ses") {
    throw new Error(`MAIL_DRIVER tidak dikenal: "${value}". Pilihannya: dummy, ses.`);
  }
  return value;
}

const senderDomain = optional("SENDER_DOMAIN", "blast.contoh.id");

export const config = {
  env: optional("NODE_ENV", "development"),
  port: Number(optional("PORT", "3000")),
  host: optional("HOST", "0.0.0.0"),

  databaseUrl: required("DATABASE_URL"),

  mail: {
    driver: mailDriver(),
    /** Tempat driver dummy menulis salinan pesan supaya bisa diperiksa. */
    outboxDir: optional("MAIL_OUTBOX_DIR", "/app/var/outbox"),
  },

  sender: {
    /**
     * Subdomain khusus kampanye. Tidak boleh sama dengan domain yang dipakai
     * korespondensi harian — kalau reputasi pengirim jatuh, email operasional
     * ikut terbawa (01-arsitektur.md).
     */
    domain: senderDomain,
    /**
     * Subdomain MAIL FROM kustom. Dipakai supaya SPF selaras dengan domain
     * pengirim di mata DMARC — penjelasannya di docs/07-domain-dan-dns.md.
     */
    mailFromSubdomain: optional("SENDER_MAIL_FROM_SUBDOMAIN", "mail"),
    address: optional("SENDER_ADDRESS", `blast@${senderDomain}`),
    name: optional("SENDER_NAME", "Nusantara Sales"),
    /** Alamat fisik, wajib tercantum di setiap pesan (04-aturan-kepatuhan.md §1). */
    postalAddress: optional("SENDER_POSTAL_ADDRESS", "Jl. Sudirman No. 45, Jakarta Selatan 12190"),
  },

  dmarc: {
    /** Alamat penerima laporan agregat DMARC. */
    reportTo: optional("DMARC_REPORT_TO", "dmarc@contoh.id"),
    /** `none` saat memulai, dinaikkan setelah laporan bersih. */
    policy: optional("DMARC_POLICY", "none"),
  },

  ses: {
    region: optional("AWS_REGION", "ap-southeast-1"),
    accessKeyId: optional("AWS_ACCESS_KEY_ID", ""),
    secretAccessKey: optional("AWS_SECRET_ACCESS_KEY", ""),
    /** Configuration set yang meneruskan event bounce dan keluhan ke SNS. */
    configurationSet: optional("SES_CONFIGURATION_SET", "marketing-blast-events"),
    /** Tiga token DKIM dari SES. Dipakai membentuk record CNAME yang diharapkan. */
    dkimTokens: list("SES_DKIM_TOKENS"),
  },
} as const;

/**
 * Dijalankan saat start. Menolak kombinasi yang akan gagal di tengah jalan —
 * lebih baik proses tidak naik daripada naik lalu diam-diam tidak mengirim.
 */
export function validateConfig(): void {
  if (config.mail.driver === "ses") {
    const missing = [
      ["AWS_ACCESS_KEY_ID", config.ses.accessKeyId],
      ["AWS_SECRET_ACCESS_KEY", config.ses.secretAccessKey],
      ["AWS_REGION", config.ses.region],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);

    if (missing.length > 0) {
      throw new Error(
        `MAIL_DRIVER=ses tapi ${missing.join(", ")} kosong. ` +
          `Isi kredensialnya atau kembalikan ke MAIL_DRIVER=dummy. Lihat docs/08-amazon-ses.md.`,
      );
    }

    if (config.ses.dkimTokens.length !== 3) {
      throw new Error(
        `SES_DKIM_TOKENS harus berisi 3 token dipisah koma, ditemukan ` +
          `${config.ses.dkimTokens.length}. Ambil dari konsol SES — docs/08-amazon-ses.md.`,
      );
    }
  }
}
