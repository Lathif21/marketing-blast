// Berhenti berlangganan. Publik, tanpa autentikasi, satu klik langsung berlaku.
//
// Ini satu-satunya bagian sistem yang dilihat penerima, dan satu-satunya yang
// wajib bekerja untuk orang yang tidak punya akun. Halaman konfirmasi
// bertingkat atau keharusan masuk akun membuatnya tidak memenuhi syarat
// "berfungsi seketika" (04-aturan-kepatuhan.md §1).
//
// Dua metode, dua pemakai:
//   GET  — penerima mengklik tautan di footer email
//   POST — klien email menekan tombol bawaannya (RFC 8058 one-click)
// Keduanya harus ada; header List-Unsubscribe-Post yang kita kirim menjanjikan
// POST bekerja.

import type { FastifyInstance } from "fastify";
import { verifyUnsubscribeToken } from "../lib/tokens.js";
import { suppressByContactId } from "../suppression/repo.js";

function page(title: string, body: string, tone: "ok" | "error" = "ok"): string {
  const accent = tone === "ok" ? "#2b7a5a" : "#8c2e2e";
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 24px;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #f6f7f9; color: #1a2028;
  }
  .card {
    background: #fff; border: 1px solid #e2e6ec; border-radius: 6px;
    padding: 32px; max-width: 480px; width: 100%;
  }
  .bar { height: 3px; background: ${accent}; border-radius: 2px; margin-bottom: 24px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { margin: 0 0 12px; color: #4a5563; }
  .email { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #1a2028; }
  @media (prefers-color-scheme: dark) {
    body { background: #0d1520; color: #dce3ec; }
    .card { background: #141e2e; border-color: rgba(100,140,180,0.16); }
    p { color: #8da0b8; }
    .email { color: #dce3ec; }
  }
</style>
</head>
<body>
  <div class="card">
    <div class="bar"></div>
    ${body}
  </div>
</body>
</html>`;
}

const NOT_VALID = page(
  "Tautan tidak berlaku",
  `<h1>Tautan tidak berlaku</h1>
   <p>Tautan berhenti berlangganan ini tidak dapat dikenali. Kemungkinan
      besar tersalin tidak lengkap.</p>
   <p>Balas email yang Anda terima dan sampaikan bahwa Anda ingin berhenti
      menerimanya — permintaan itu tetap kami proses.</p>`,
  "error",
);

function done(email: string): string {
  return page(
    "Berhasil berhenti berlangganan",
    `<h1>Anda telah berhenti berlangganan</h1>
     <p><span class="email">${escapeHtml(email)}</span> tidak akan lagi menerima
        email kampanye dari kami.</p>
     <p>Berlaku seketika dan permanen. Tidak ada yang perlu Anda lakukan lagi.</p>`,
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

export async function unsubscribeRoutes(app: FastifyInstance) {
  const handler = async (token: string) => {
    const contactId = verifyUnsubscribeToken(token);
    if (!contactId) return { code: 404, html: NOT_VALID };

    const result = await suppressByContactId(contactId, "unsubscribe");

    // Token sah tapi kontaknya sudah tidak ada. Tetap tampilkan berhasil:
    // dari sisi penerima, hasil akhirnya memang sama — mereka tidak akan
    // dikirimi lagi. Menampilkan galat hanya membuat mereka mencoba lagi.
    if (!result) return { code: 200, html: done("Alamat Anda") };

    return { code: 200, html: done(result.email) };
  };

  app.get<{ Params: { token: string } }>("/unsubscribe/:token", async (req, reply) => {
    const { code, html } = await handler(req.params.token);
    return reply.code(code).type("text/html; charset=utf-8").send(html);
  });

  // RFC 8058: klien email mengirim POST dengan body
  // `List-Unsubscribe=One-Click`. Tidak boleh menuntut apa pun selain itu.
  app.post<{ Params: { token: string } }>("/unsubscribe/:token", async (req, reply) => {
    const { code, html } = await handler(req.params.token);
    return reply.code(code).type("text/html; charset=utf-8").send(html);
  });
}
