// Record DNS yang harus ada sebelum pengiriman pertama, diturunkan dari
// konfigurasi. Ditaruh di kode supaya dokumen dan kenyataan tidak berpisah:
// mengubah SENDER_DOMAIN otomatis mengubah record yang diharapkan, dan
// `npm run dns:check` membandingkannya dengan DNS yang benar-benar terpasang.
//
// Penjelasan tiap record ada di docs/07-domain-dan-dns.md.

import { promises as dns } from "node:dns";
import { config } from "../config.js";

/**
 * Token DKIM contoh, dipakai selama SES_DKIM_TOKENS belum diisi. Bentuknya
 * meniru keluaran SES supaya dokumentasi dan pemeriksa DNS bisa diuji lebih
 * dulu, tapi nilainya karangan — tidak akan pernah cocok dengan DNS mana pun.
 */
export const DUMMY_DKIM_TOKENS = [
  "dummy7k2xqf4hbn6mzr3vwycp5tsjld8a",
  "dummyq9wnv2ecx7fh4kzm6bpr3tyusjd5",
  "dummyj3mzt8xhq5vrf2wnc7kbpy4sude6",
];

export type RecordType = "TXT" | "CNAME" | "MX";

export interface ExpectedRecord {
  /** Untuk apa record ini ada, dalam satu kalimat. */
  purpose: string;
  type: RecordType;
  name: string;
  value: string;
  /** Hanya untuk MX. */
  priority?: number;
  /** Cara menilai nilai yang ditemukan sudah benar. */
  matches: (found: string[]) => boolean;
}

const has = (needle: string) => (found: string[]) =>
  found.some((v) => v.toLowerCase().includes(needle.toLowerCase()));

export function dkimTokens(): string[] {
  return config.ses.dkimTokens.length === 3 ? [...config.ses.dkimTokens] : DUMMY_DKIM_TOKENS;
}

export function usingDummyTokens(): boolean {
  return config.ses.dkimTokens.length !== 3;
}

export function mailFromDomain(): string {
  return `${config.sender.mailFromSubdomain}.${config.sender.domain}`;
}

export function expectedRecords(): ExpectedRecord[] {
  const domain = config.sender.domain;
  const mailFrom = mailFromDomain();
  const region = config.ses.region;

  const records: ExpectedRecord[] = [
    {
      purpose: "SPF pada domain pengirim — mengizinkan SES mengirim atas nama domain ini",
      type: "TXT",
      name: domain,
      value: "v=spf1 include:amazonses.com -all",
      matches: (found) =>
        found.some((v) => v.toLowerCase().startsWith("v=spf1") && v.includes("amazonses.com")),
    },
    {
      purpose: "SPF pada MAIL FROM kustom — yang sebenarnya diperiksa penerima saat bounce",
      type: "TXT",
      name: mailFrom,
      value: "v=spf1 include:amazonses.com ~all",
      matches: (found) =>
        found.some((v) => v.toLowerCase().startsWith("v=spf1") && v.includes("amazonses.com")),
    },
    {
      purpose: "MAIL FROM kustom — ke mana SES mengembalikan pemantulan",
      type: "MX",
      name: mailFrom,
      value: `feedback-smtp.${region}.amazonses.com`,
      priority: 10,
      matches: has(`feedback-smtp.${region}.amazonses.com`),
    },
    {
      purpose: "DMARC — memberi tahu penerima apa yang harus dilakukan bila SPF dan DKIM gagal",
      type: "TXT",
      name: `_dmarc.${domain}`,
      value:
        `v=DMARC1; p=${config.dmarc.policy}; rua=mailto:${config.dmarc.reportTo}; ` +
        `adkim=r; aspf=r; pct=100`,
      matches: (found) => found.some((v) => v.toLowerCase().startsWith("v=dmarc1")),
    },
  ];

  for (const [i, token] of dkimTokens().entries()) {
    records.push({
      purpose: `DKIM ${i + 1} dari 3 — tanda tangan kriptografis pada setiap pesan`,
      type: "CNAME",
      name: `${token}._domainkey.${domain}`,
      value: `${token}.dkim.amazonses.com`,
      matches: has(`${token}.dkim.amazonses.com`),
    });
  }

  return records;
}

export type CheckStatus = "ok" | "salah" | "tidak ada";

export interface CheckResult {
  record: ExpectedRecord;
  status: CheckStatus;
  found: string[];
}

async function lookup(record: ExpectedRecord): Promise<string[]> {
  try {
    switch (record.type) {
      case "TXT": {
        // Satu record TXT bisa terpecah beberapa string; DNS menggabungkannya.
        const rows = await dns.resolveTxt(record.name);
        return rows.map((parts) => parts.join(""));
      }
      case "CNAME":
        return await dns.resolveCname(record.name);
      case "MX": {
        const rows = await dns.resolveMx(record.name);
        return rows.map((r) => `${r.priority} ${r.exchange}`);
      }
    }
  } catch {
    // ENOTFOUND / ENODATA sama artinya di sini: record belum dipasang.
    return [];
  }
}

export async function checkRecords(): Promise<CheckResult[]> {
  const records = expectedRecords();
  return Promise.all(
    records.map(async (record) => {
      const found = await lookup(record);
      const status: CheckStatus =
        found.length === 0 ? "tidak ada" : record.matches(found) ? "ok" : "salah";
      return { record, status, found };
    }),
  );
}
