// Gerbang sesi, lalu satu dari dua aplikasi.
//
// Yang menentukan bukan tombol navigasi melainkan siapa yang masuk:
//
//   superadmin tanpa impersonasi → konsol pelanggan, TANPA layar kampanye
//   superadmin yang berimpersonasi → aplikasi pelanggan + bilah peringatan
//   admin/operator pelanggan → aplikasi pelanggan
//
// Superadmin murni sengaja tidak diberi layar kampanye. Server pun menolaknya
// (409 `pilih_pelanggan`), dan alasannya ada di auth/plugin.ts: konteksnya
// melewati penyaringan pelanggan, jadi daftar kontak yang muncul adalah
// gabungan SELURUH pelanggan — angka yang akan dibaca sebagai angka satu
// pelanggan. Menu yang menuntun ke sana hanya menjanjikan layar yang akan
// menolak.

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { CampaignBuilderScreen } from "./screens/CampaignBuilderScreen";
import { ContactsScreen } from "./screens/ContactsScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
import { FollowUpScreen } from "./screens/FollowUpScreen";
import { ImportScreen } from "./screens/ImportScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { ReportScreen } from "./screens/ReportScreen";
import { SuperadminScreen, BilahImpersonasi } from "./screens/SuperadminScreen";
import { SuppressionScreen } from "./screens/SuppressionScreen";
import { DomainHealthProvider } from "./lib/domainHealth";
import { ApiError, logout, sesiSaya, type SesiSaya } from "./lib/api";
import type { Screen } from "./lib/types";

function Memuat() {
  return (
    <div
      className="h-screen flex items-center justify-center gap-2 text-xs"
      style={{ backgroundColor: "var(--background)", color: "var(--muted-foreground)" }}
    >
      <Loader2 size={14} className="animate-spin" />
      Memuat…
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [sesi, setSesi] = useState<SesiSaya | null>(null);
  const [memuat, setMemuat] = useState(true);

  const muatSesi = useCallback(async () => {
    try {
      setSesi(await sesiSaya());
    } catch (err) {
      // 401 berarti belum masuk — keadaan biasa, bukan galat yang perlu
      // ditampilkan. Galat lain pun berakhir di layar masuk: tanpa sesi tidak
      // ada apa pun yang dapat ditampilkan, dan layar masuk setidaknya
      // menawarkan jalan ke depan.
      if (!(err instanceof ApiError)) console.error(err);
      setSesi(null);
    } finally {
      setMemuat(false);
    }
  }, []);

  useEffect(() => {
    void muatSesi();
  }, [muatSesi]);

  // Sesi bisa berakhir di tengah pemakaian — kedaluwarsa, atau dicabut karena
  // pelanggannya dibekukan. `lib/api.ts` menyiarkan kejadian itu supaya
  // seluruh aplikasi kembali ke layar masuk sekaligus, bukan menyisakan layar
  // yang setiap tombolnya gagal tanpa penjelasan.
  useEffect(() => {
    const dengar = () => setSesi(null);
    window.addEventListener("mb:sesi-habis", dengar);
    return () => window.removeEventListener("mb:sesi-habis", dengar);
  }, []);

  async function keluar() {
    try {
      await logout();
    } finally {
      setSesi(null);
    }
  }

  if (memuat) return <Memuat />;
  if (!sesi) return <LoginScreen onMasuk={setSesi} />;

  const superadminMurni = sesi.peran === "superadmin" && !sesi.impersonasi;

  if (superadminMurni) {
    return (
      <div
        className="flex flex-col h-screen overflow-hidden bg-background text-foreground"
        style={{ fontFamily: "'Inter', ui-sans-serif, system-ui" }}
      >
        <Header screen="superadmin" sesi={sesi} onKeluar={keluar} />
        <main className="flex-1 overflow-y-auto">
          {/* Setelah impersonasi dimulai, sesinya dimuat ulang — seluruh
              aplikasi berpindah konteks, termasuk kesehatan domain. */}
          <SuperadminScreen onImpersonasi={() => void muatSesi()} />
        </main>
      </div>
    );
  }

  return (
    <DomainHealthProvider>
      <div
        className="flex h-screen overflow-hidden bg-background text-foreground"
        style={{ fontFamily: "'Inter', ui-sans-serif, system-ui" }}
      >
        <Sidebar screen={screen} onNavigate={setScreen} />
        <div className="flex-1 flex flex-col overflow-hidden">
          {sesi.impersonasi && (
            <BilahImpersonasi
              nama={sesi.impersonasi.nama ?? sesi.impersonasi.slug ?? "pelanggan"}
              onKeluar={() => void muatSesi()}
            />
          )}
          <Header screen={screen} sesi={sesi} onKeluar={keluar} />
          {sesi.tenant?.status === "dibekukan" && (
            <div
              className="px-6 py-2 flex-shrink-0"
              style={{
                backgroundColor: "rgb(var(--peringatan-rgb) / 0.15)",
                borderBottom: "1px solid rgb(var(--peringatan-rgb) / 0.25)",
              }}
            >
              <p className="text-xs leading-relaxed" style={{ color: "var(--peringatan)" }}>
                <strong>Pengiriman dibekukan penyedia layanan.</strong>{" "}
                {sesi.tenant.alasan_beku} — Data Anda tetap utuh dan dapat dilihat seperti biasa;
                yang berhenti hanyalah pengiriman kampanye.
              </p>
            </div>
          )}
          <main
            className="flex-1 overflow-y-auto"
            style={{ scrollbarWidth: "thin", scrollbarColor: "rgb(var(--kabut-rgb) / 0.18) transparent" }}
          >
            {screen === "dashboard" && <DashboardScreen onNavigate={setScreen} />}
            {screen === "import" && <ImportScreen />}
            {screen === "contacts" && <ContactsScreen onNavigate={setScreen} />}
            {screen === "builder" && <CampaignBuilderScreen onNavigate={setScreen} />}
            {screen === "followup" && <FollowUpScreen />}
            {screen === "report" && <ReportScreen />}
            {screen === "suppression" && <SuppressionScreen />}
          </main>
        </div>
      </div>
    </DomainHealthProvider>
  );
}
