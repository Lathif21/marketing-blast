// Membandingkan DNS yang terpasang dengan yang diharapkan konfigurasi.
//
//   npm run dns:check
//
// Selama SENDER_DOMAIN masih dummy, semua baris akan berstatus "tidak ada".
// Itu memang hasil yang benar — belum ada yang dipasang.

import { config } from "../config.js";
import { checkRecords, mailFromDomain, usingDummyTokens } from "../domain/dns.js";

const ICON: Record<string, string> = { ok: "✓", salah: "!", "tidak ada": "×" };

async function main() {
  console.log(`Domain pengirim : ${config.sender.domain}`);
  console.log(`MAIL FROM       : ${mailFromDomain()}`);
  console.log(`Region SES      : ${config.ses.region}`);
  console.log(`Driver email    : ${config.mail.driver}`);
  if (usingDummyTokens()) {
    console.log(
      `\nCatatan: SES_DKIM_TOKENS belum diisi, jadi tiga baris DKIM di bawah\n` +
        `memakai token contoh dan tidak akan pernah cocok. Ambil token asli\n` +
        `dari konsol SES — docs/08-amazon-ses.md.`,
    );
  }
  console.log("");

  const results = await checkRecords();

  for (const { record, status, found } of results) {
    console.log(`${ICON[status]} ${record.type.padEnd(5)} ${record.name}`);
    console.log(`  guna     : ${record.purpose}`);
    console.log(`  harapan  : ${record.value}`);
    if (status === "salah") {
      console.log(`  ditemukan: ${found.join(" | ")}`);
    }
    console.log("");
  }

  const ok = results.filter((r) => r.status === "ok").length;
  console.log(`${ok} dari ${results.length} record sudah benar.`);

  if (ok < results.length) {
    console.log(`Langkah pemasangannya ada di docs/07-domain-dan-dns.md.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
