// Layar masuk.
//
// Satu-satunya layar yang terlihat tanpa sesi. Sengaja tidak menawarkan
// "daftar akun": akun pelanggan dibuat superadmin, dan pendaftaran terbuka
// pada produk yang mengirim email atas nama domain orang lain adalah undangan
// untuk dipakai mengirim spam dari reputasi yang sedang dibangun.
//
// Pesan galat tidak membedakan "email tidak terdaftar" dari "sandi salah" —
// server pun tidak. Perbedaan itu akan mengubah layar ini menjadi alat untuk
// memeriksa siapa saja yang punya akun di instalasi ini.

import { useState } from "react";
import { Loader2, Mail, ShieldAlert } from "lucide-react";
import { ApiError, login, type SesiSaya } from "../lib/api";
import { PengalihTema } from "../components/PengalihTema";

export function LoginScreen({ onMasuk }: { onMasuk: (sesi: SesiSaya) => void }) {
  const [email, setEmail] = useState("");
  const [sandi, setSandi] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    setSibuk(true);
    setGalat(null);
    try {
      onMasuk(await login(email.trim(), sandi));
    } catch (err) {
      setGalat(
        err instanceof ApiError ? err.message : ((err as Error)?.message ?? "Galat tidak dikenal"),
      );
    } finally {
      setSibuk(false);
    }
  }

  return (
    <div
      className="h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: "var(--background)", fontFamily: "'Inter', ui-sans-serif, system-ui" }}
    >
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6">
          {/* Pengalih ikut hadir di sini karena Header belum tampil sebelum
              masuk — dan layar masuk adalah layar pertama yang dilihat orang. */}
          <div
            className="w-7 h-7 rounded-sm flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "var(--primary)" }}
          >
            <Mail size={15} color="var(--primary-foreground)" />
          </div>
          <span
            className="uppercase tracking-widest font-bold"
            style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              letterSpacing: "0.12em",
              color: "var(--foreground)",
              fontSize: "15px",
            }}
          >
            Marketing Blast
          </span>
          <PengalihTema className="ml-auto" />
        </div>

        <form
          onSubmit={kirim}
          className="bg-card border border-border rounded-sm p-5 space-y-4"
        >
          <div>
            <h1 className="text-sm text-foreground">Masuk</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Akun dibuat oleh penyedia layanan.
            </p>
          </div>

          <label className="block">
            <span className="text-xs text-muted-foreground">Email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full bg-input-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground font-mono"
            />
          </label>

          <label className="block">
            <span className="text-xs text-muted-foreground">Kata sandi</span>
            <input
              type="password"
              autoComplete="current-password"
              value={sandi}
              onChange={(e) => setSandi(e.target.value)}
              className="mt-1 w-full bg-input-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground"
            />
          </label>

          <button
            type="submit"
            disabled={sibuk || !email.trim() || !sandi}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-sm text-xs transition-colors disabled:opacity-50"
            style={{ backgroundColor: "rgb(var(--primary-rgb) / 0.15)", color: "var(--primary)" }}
          >
            {sibuk && <Loader2 size={12} className="animate-spin" />}
            Masuk
          </button>

          {galat && (
            <p className="text-xs flex items-start gap-1.5" style={{ color: "var(--bahaya)" }}>
              <ShieldAlert size={12} style={{ flexShrink: 0, marginTop: 1 }} />
              {galat}
            </p>
          )}
        </form>

        <p className="text-xs mt-4 leading-relaxed" style={{ color: "var(--samar)" }}>
          Lupa kata sandi? Penyedia layanan yang menyetelnya ulang — sistem ini tidak mengirim
          email pemulihan, justru supaya domain pengirimnya tidak dipakai untuk apa pun selain
          kampanye yang Anda susun sendiri.
        </p>
      </div>
    </div>
  );
}
