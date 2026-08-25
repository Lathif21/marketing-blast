import { test } from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import {
  buildStringToSign,
  isAllowedCertUrl,
  isAllowedSnsUrl,
  verifySnsMessage,
  type SnsMessage,
} from "../lib/sns.js";
import { extractSuppressions } from "../suppression/ses-events.js";

// Pasangan kunci sekali pakai sebagai "sertifikat AWS" palsu, supaya
// verifikasi dapat diuji tanpa jaringan.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();
const CERT_URL = "https://sns.ap-southeast-1.amazonaws.com/SimpleNotification-abc.pem";
const certFetcher = async () => PUBLIC_PEM;

function sign(message: Omit<SnsMessage, "Signature">): SnsMessage {
  const signer = createSign("RSA-SHA1");
  signer.update(buildStringToSign(message as SnsMessage), "utf8");
  signer.end();
  return { ...message, Signature: signer.sign(privateKey, "base64") };
}

const notification = (body: unknown): Omit<SnsMessage, "Signature"> => ({
  Type: "Notification",
  MessageId: "m-1",
  TopicArn: "arn:aws:sns:ap-southeast-1:123:blast",
  Message: JSON.stringify(body),
  Timestamp: "2026-08-25T00:00:00.000Z",
  SignatureVersion: "1",
  SigningCertURL: CERT_URL,
});

test("pesan bertanda tangan sah diterima", async () => {
  const msg = sign(notification({ notificationType: "Bounce" }));
  assert.deepEqual(await verifySnsMessage(msg, { certFetcher }), { ok: true });
});

test("tanda tangan salah ditolak", async () => {
  const msg = sign(notification({ notificationType: "Bounce" }));
  msg.Signature = Buffer.from("palsu").toString("base64");
  const result = await verifySnsMessage(msg, { certFetcher });
  assert.equal(result.ok, false);
});

test("mengubah isi Message setelah ditandatangani membatalkan tanda tangan", async () => {
  const msg = sign(notification({ notificationType: "Bounce" }));
  msg.Message = JSON.stringify({ notificationType: "Complaint" });
  const result = await verifySnsMessage(msg, { certFetcher });
  assert.equal(result.ok, false);
});

test("SigningCertURL di luar host SNS AWS ditolak", async () => {
  const msg = sign({ ...notification({}), SigningCertURL: "https://penyerang.id/cert.pem" });
  const result = await verifySnsMessage(msg, { certFetcher });
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /host SNS AWS/);
});

test("host yang hanya menyerupai host AWS ditolak", () => {
  assert.equal(isAllowedCertUrl("https://sns.ap-southeast-1.amazonaws.com/a.pem"), true);
  assert.equal(
    isAllowedCertUrl("https://sns.ap-southeast-1.amazonaws.com.penyerang.id/a.pem"),
    false,
  );
  assert.equal(isAllowedCertUrl("https://penyerang.id/sns.amazonaws.com/a.pem"), false);
  assert.equal(isAllowedCertUrl("http://sns.ap-southeast-1.amazonaws.com/a.pem"), false);
  assert.equal(isAllowedCertUrl("https://sns.ap-southeast-1.amazonaws.com/a.txt"), false);
  assert.equal(isAllowedSnsUrl("https://sns.us-east-1.amazonaws.com/?Action=Confirm"), true);
});

test("TopicArn yang tidak sesuai ditolak walau tanda tangannya sah", async () => {
  const msg = sign(notification({ notificationType: "Bounce" }));
  const result = await verifySnsMessage(msg, {
    certFetcher,
    allowedTopicArn: "arn:aws:sns:ap-southeast-1:123:lain",
  });
  assert.equal(result.ok, false);
});

test("Subject yang tidak ada dilewati, bukan ditandatangani sebagai string kosong", () => {
  const tanpa = buildStringToSign(notification({}) as SnsMessage);
  assert.equal(tanpa.includes("Subject"), false);
  const dengan = buildStringToSign({ ...notification({}), Subject: "x" } as SnsMessage);
  assert.equal(dengan.includes("Subject\nx\n"), true);
});

test("urutan field yang ditandatangani mengikuti spesifikasi SNS", () => {
  const s = buildStringToSign(notification({}) as SnsMessage);
  const fields = s
    .split("\n")
    .filter((_, i) => i % 2 === 0)
    .filter(Boolean);
  assert.deepEqual(fields.slice(0, 5), ["Message", "MessageId", "Timestamp", "TopicArn", "Type"]);
});

// ─── Pemetaan notifikasi SES ke daftar penekanan ─────────────────────────────

test("pemantulan permanen masuk daftar penekanan", () => {
  const hasil = extractSuppressions({
    notificationType: "Bounce",
    bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: "mati@x.id" }] },
  });
  assert.deepEqual(hasil, [{ email: "mati@x.id", reason: "hard_bounce" }]);
});

test("pemantulan sementara TIDAK masuk daftar penekanan", () => {
  const hasil = extractSuppressions({
    notificationType: "Bounce",
    bounce: { bounceType: "Transient", bouncedRecipients: [{ emailAddress: "penuh@x.id" }] },
  });
  assert.deepEqual(hasil, []);
});

test("keluhan spam masuk daftar penekanan", () => {
  const hasil = extractSuppressions({
    notificationType: "Complaint",
    complaint: { complainedRecipients: [{ emailAddress: "lapor@x.id" }] },
  });
  assert.deepEqual(hasil, [{ email: "lapor@x.id", reason: "keluhan" }]);
});

test("notifikasi Delivery tidak menekan siapa pun", () => {
  assert.deepEqual(extractSuppressions({ notificationType: "Delivery" }), []);
});

test("bentuk eventType dari configuration set juga dikenali", () => {
  const hasil = extractSuppressions({
    eventType: "Complaint",
    complaint: { complainedRecipients: [{ emailAddress: "a@x.id" }] },
  });
  assert.equal(hasil.length, 1);
});
