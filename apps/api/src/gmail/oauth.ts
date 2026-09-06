// Alur izin Google, sisi server.
//
// Bentuknya sama seperti "masuk dengan GitHub" di Netlify: pengguna diarahkan
// ke halaman izin milik Google, memilih akun dan menyetujui apa yang diminta,
// lalu kembali membawa kode sekali pakai. Kredensial akun Google-nya tidak
// pernah melewati sistem ini.
//
// Dua hal yang menentukan keamanan alur ini, dan keduanya mudah terlewat:
//
//   1. `state` HARUS diikat ke sesi yang memulainya. Tanpa itu, penyerang
//      dapat memancing korban membuka URL callback berisi kode milik AKUN
//      PENYERANG — dan kotak masuk penyerang lalu tersambung ke pelanggan
//      korban, yang kemudian mengimpor "kontak" pilihan penyerang. Di sini
//      `state` ditandatangani HMAC berisi tenant, pengguna, dan kedaluwarsa.
//
//   2. `access_type=offline` + `prompt=consent` diperlukan supaya Google
//      mengirim refresh token. Tanpa `prompt=consent`, izin kedua dan
//      seterusnya untuk akun yang sama TIDAK menyertakan refresh token —
//      alurnya terlihat berhasil, koneksinya tersimpan, lalu gagal pada
//      sinkronisasi pertama tanpa alasan yang jelas.

import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

/**
 * Scope yang diminta.
 *
 * `gmail.readonly`, bukan `gmail.metadata` yang lebih sempit. Bukan karena
 * kita membutuhkan isi pesan — analisis tidak pernah menyentuhnya — melainkan
 * karena `gmail.metadata` TIDAK mengizinkan parameter pencarian `q` pada
 * `users.messages.list`. Tanpa pencarian, satu-satunya cara menemukan pesan
 * baru adalah menelusuri seluruh kotak masuk halaman demi halaman, dan kuota
 * Gmail API akan habis jauh sebelum kotak masuk besar selesai dibaca.
 *
 * Keduanya sama-sama scope "restricted" di mata Google, jadi yang lebih sempit
 * pun tidak menghindarkan proses verifikasi.
 */
export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Umur `state`. Cukup untuk memilih akun dan membaca layar izin, tidak lebih. */
const UMUR_STATE_DETIK = 15 * 60;

export function integrasiAktif(): boolean {
  return Boolean(config.google.clientId && config.google.clientSecret && config.google.redirectUri);
}

// ── state yang ditandatangani ───────────────────────────────────────────────

interface IsiState {
  tenantId: string;
  userId: string;
  sampai: number;
}

function tandaTangan(muatan: string): string {
  return createHmac("sha256", config.tokenSecret).update(muatan).digest("base64url");
}

export function buatState(tenantId: string, userId: string): string {
  const isi: IsiState = {
    tenantId,
    userId,
    sampai: Math.floor(Date.now() / 1000) + UMUR_STATE_DETIK,
  };
  const muatan = Buffer.from(JSON.stringify(isi), "utf8").toString("base64url");
  return `${muatan}.${tandaTangan(muatan)}`;
}

/** `null` bila tanda tangannya tidak cocok, bentuknya salah, atau kedaluwarsa. */
export function bacaState(state: string): { tenantId: string; userId: string } | null {
  const titik = state.lastIndexOf(".");
  if (titik <= 0) return null;

  const muatan = state.slice(0, titik);
  const diberikan = Buffer.from(state.slice(titik + 1), "utf8");
  const diharapkan = Buffer.from(tandaTangan(muatan), "utf8");

  // Panjang dibandingkan lebih dulu: `timingSafeEqual` melempar bila
  // panjangnya berbeda, dan lemparan itu sendiri membocorkan informasi.
  if (diberikan.length !== diharapkan.length) return null;
  if (!timingSafeEqual(diberikan, diharapkan)) return null;

  try {
    const isi = JSON.parse(Buffer.from(muatan, "base64url").toString("utf8")) as IsiState;
    if (!isi.tenantId || !isi.userId) return null;
    if (isi.sampai < Math.floor(Date.now() / 1000)) return null;
    return { tenantId: isi.tenantId, userId: isi.userId };
  } catch {
    return null;
  }
}

// ── Alur ────────────────────────────────────────────────────────────────────

export function urlIzin(state: string, petunjukEmail?: string): string {
  const p = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    // Wajib keduanya supaya refresh token benar-benar dikirim. Lihat catatan
    // di kepala berkas.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  if (petunjukEmail) p.set("login_hint", petunjukEmail);
  return `${AUTH_URL}?${p.toString()}`;
}

export interface TokenGoogle {
  accessToken: string;
  /** Tidak selalu ada — lihat catatan `prompt=consent` di kepala berkas. */
  refreshToken: string | null;
  scope: string;
  kedaluwarsaDetik: number;
  idToken: string | null;
}

async function mintaToken(isi: Record<string, string>): Promise<TokenGoogle> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      ...isi,
    }).toString(),
  });

  const badan = (await res.json().catch(() => null)) as Record<string, unknown> | null;

  if (!res.ok) {
    // Pesan galat Google diteruskan apa adanya: `invalid_grant` yang berarti
    // "token sudah kedaluwarsa" perlu dibedakan dari `redirect_uri_mismatch`
    // yang berarti "konfigurasinya salah", dan hanya Google yang tahu mana.
    const kode = typeof badan?.error === "string" ? badan.error : `HTTP ${res.status}`;
    const rinci = typeof badan?.error_description === "string" ? ` — ${badan.error_description}` : "";
    throw new GalatOAuth(kode, `Google menolak permintaan token: ${kode}${rinci}`);
  }

  return {
    accessToken: String(badan?.access_token ?? ""),
    refreshToken: typeof badan?.refresh_token === "string" ? badan.refresh_token : null,
    scope: String(badan?.scope ?? ""),
    kedaluwarsaDetik: Number(badan?.expires_in ?? 0),
    idToken: typeof badan?.id_token === "string" ? badan.id_token : null,
  };
}

export class GalatOAuth extends Error {
  constructor(
    public kode: string,
    pesan: string,
  ) {
    super(pesan);
    this.name = "GalatOAuth";
  }

  /**
   * `invalid_grant` berarti token penyegarnya tidak berlaku lagi: dicabut
   * pengguna, atau — yang paling sering pada aplikasi berstatus "Testing" —
   * kedaluwarsa setelah tujuh hari. Keduanya hanya dapat dipulihkan dengan
   * menyambungkan ulang, jadi keduanya berakhir pada pesan yang sama.
   */
  get perluSambungUlang(): boolean {
    return this.kode === "invalid_grant";
  }
}

export const tukarKode = (code: string) =>
  mintaToken({ code, redirect_uri: config.google.redirectUri, grant_type: "authorization_code" });

export const segarkanToken = (refreshToken: string) =>
  mintaToken({ refresh_token: refreshToken, grant_type: "refresh_token" });

/**
 * Membaca alamat dan pengenal akun dari `id_token`.
 *
 * Tanda tangannya TIDAK diverifikasi di sini, dan itu aman dalam konteks ini:
 * token ini baru saja diterima langsung dari Google lewat koneksi TLS ke
 * `oauth2.googleapis.com` sebagai jawaban atas permintaan kita sendiri —
 * bukan diterima dari peramban pengguna. Verifikasi tanda tangan diperlukan
 * ketika token datang dari pihak yang tidak dipercaya; di sini pengirimnya
 * adalah Google itu sendiri.
 */
export function bacaIdToken(idToken: string): { email: string; sub: string } | null {
  const bagian = idToken.split(".");
  if (bagian.length !== 3) return null;
  try {
    const isi = JSON.parse(Buffer.from(bagian[1], "base64url").toString("utf8")) as {
      email?: string;
      sub?: string;
      email_verified?: boolean;
    };
    if (!isi.email || !isi.sub) return null;
    return { email: isi.email.toLowerCase(), sub: isi.sub };
  } catch {
    return null;
  }
}
