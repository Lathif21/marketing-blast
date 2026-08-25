// Verifikasi tanda tangan Amazon SNS.
//
// `/webhooks/ses` tidak berada di balik autentikasi — SNS tidak bisa membawa
// kredensial kita. Verifikasi tanda tangan inilah satu-satunya pengamanannya.
//
// Tanpa ini, siapa pun yang tahu URL webhook dapat mengirim pemantulan palsu
// dan memasukkan alamat sembarangan ke daftar penekanan yang TIDAK punya
// operasi hapus. Kerusakannya permanen dan tidak dapat dibatalkan lewat UI.

import { createVerify, createPublicKey } from "node:crypto";

export interface SnsMessage {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL?: string;
  SigningCertUrl?: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
}

/**
 * Urutan field yang ditandatangani berbeda menurut tipe pesan, dan urutannya
 * mengikat — salah urutan berarti tanda tangan yang sah pun ditolak.
 */
const SIGNED_FIELDS: Record<string, string[]> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: [
    "Message",
    "MessageId",
    "SubscribeURL",
    "Timestamp",
    "Token",
    "TopicArn",
    "Type",
  ],
  UnsubscribeConfirmation: [
    "Message",
    "MessageId",
    "SubscribeURL",
    "Timestamp",
    "Token",
    "TopicArn",
    "Type",
  ],
};

export function buildStringToSign(message: SnsMessage): string {
  const fields = SIGNED_FIELDS[message.Type];
  if (!fields) throw new Error(`Tipe pesan SNS tidak dikenal: ${message.Type}`);

  let out = "";
  for (const field of fields) {
    const value = (message as unknown as Record<string, unknown>)[field];
    // `Subject` opsional: kalau tidak ada, ia dilewati sepenuhnya — bukan
    // dimasukkan sebagai string kosong.
    if (value === undefined || value === null) continue;
    out += `${field}\n${String(value)}\n`;
  }
  return out;
}

/**
 * Hanya sertifikat dari host SNS AWS yang diterima. Tanpa pemeriksaan ini,
 * penyerang cukup menunjuk `SigningCertURL` ke servernya sendiri dan
 * menandatangani apa pun.
 */
export function isAllowedSnsUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(url.hostname);
}

/** Sertifikat harus berupa berkas .pem pada host SNS AWS. */
export function isAllowedCertUrl(raw: string): boolean {
  if (!isAllowedSnsUrl(raw)) return false;
  return new URL(raw).pathname.endsWith(".pem");
}

export type CertFetcher = (url: string) => Promise<string>;

const certCache = new Map<string, string>();

const fetchCert: CertFetcher = async (url) => {
  const cached = certCache.get(url);
  if (cached) return cached;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gagal mengambil sertifikat SNS: ${res.status}`);
  const pem = await res.text();
  certCache.set(url, pem);
  return pem;
};

export interface VerifyOptions {
  /** Disuntikkan pada pengujian supaya tidak perlu jaringan. */
  certFetcher?: CertFetcher;
  /** Batasi topik yang diterima. Kosong berarti terima semua topik. */
  allowedTopicArn?: string;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function verifySnsMessage(
  message: SnsMessage,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const certUrl = message.SigningCertURL ?? message.SigningCertUrl;
  if (!certUrl) return { ok: false, reason: "SigningCertURL tidak ada" };
  if (!isAllowedCertUrl(certUrl)) return { ok: false, reason: "SigningCertURL bukan host SNS AWS" };
  if (!message.Signature) return { ok: false, reason: "Signature tidak ada" };
  if (!SIGNED_FIELDS[message.Type]) return { ok: false, reason: "Tipe pesan tidak dikenal" };

  if (options.allowedTopicArn && message.TopicArn !== options.allowedTopicArn) {
    return { ok: false, reason: "TopicArn tidak sesuai" };
  }

  const algorithm =
    message.SignatureVersion === "1"
      ? "RSA-SHA1"
      : message.SignatureVersion === "2"
        ? "RSA-SHA256"
        : null;
  if (!algorithm) {
    return { ok: false, reason: `SignatureVersion tidak dikenal: ${message.SignatureVersion}` };
  }

  let stringToSign: string;
  try {
    stringToSign = buildStringToSign(message);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }

  let publicKey;
  try {
    const pem = await (options.certFetcher ?? fetchCert)(certUrl);
    publicKey = createPublicKey(pem);
  } catch (err) {
    return { ok: false, reason: `Sertifikat tidak dapat dibaca: ${(err as Error).message}` };
  }

  let valid = false;
  try {
    const verifier = createVerify(algorithm);
    verifier.update(stringToSign, "utf8");
    verifier.end();
    valid = verifier.verify(publicKey, message.Signature, "base64");
  } catch {
    valid = false;
  }

  return valid ? { ok: true } : { ok: false, reason: "Tanda tangan tidak cocok" };
}

/** Hanya dipakai pengujian. */
export function __clearCertCache() {
  certCache.clear();
}
