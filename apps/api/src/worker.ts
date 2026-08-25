// Penjadwal pekerjaan latar. Satu proses menjalankan seluruh job; pada volume
// yang ditargetkan itu memadai, dan menambah proses berarti menambah yang harus
// dipantau satu orang yang sama (01-arsitektur.md).

import { validateConfig } from "./config.js";
import { close, ping } from "./db.js";
import { JOBS } from "./jobs/index.js";
import { mailDriver } from "./mail/index.js";
import { scheduleEvery, type Cancellable } from "./scheduler.js";

const scheduled: Cancellable[] = [];
let stopping = false;

async function runJob(name: string, fn: () => Promise<void>) {
  if (stopping) return;
  const started = Date.now();
  try {
    await fn();
    console.info(`[job] ${name}: selesai dalam ${Date.now() - started}ms`);
  } catch (err) {
    // Satu job gagal tidak boleh menjatuhkan job lain.
    console.error(`[job] ${name}: gagal`, err);
  }
}

async function start() {
  try {
    validateConfig();
  } catch (err) {
    console.error("[worker] konfigurasi tidak valid", err);
    process.exit(1);
  }

  try {
    await ping();
    console.info("[worker] basis data terhubung");
  } catch (err) {
    console.error("[worker] basis data tidak dapat dihubungi", err);
    process.exit(1);
  }

  const mail = mailDriver();
  console.info(
    `[worker] driver email: ${mail.name} ` +
      `(${mail.sendsRealEmail ? "MENGIRIM SUNGGUHAN" : "tidak mengirim ke internet"})`,
  );

  for (const job of JOBS) {
    scheduled.push(scheduleEvery(job.intervalMs, () => runJob(job.name, job.run)));
    const menit = Math.round(job.intervalMs / 60_000);
    console.info(`[worker] ${job.name} dijadwalkan tiap ${menit} menit (fase ${job.phase})`);
  }

  console.info(`[worker] ${JOBS.length} pekerjaan aktif`);
}

async function shutdown(signal: string) {
  stopping = true;
  console.info(`[worker] shutdown (${signal})`);
  scheduled.forEach((s) => s.cancel());
  await close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

void start();
