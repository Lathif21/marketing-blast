// Kartu koneksi Gmail.
//
// Bentuknya mengikuti pola yang sudah dikenal orang dari Netlify dan sejenisnya:
// satu tombol yang membawa ke halaman izin milik Google, lalu daftar apa yang
// sudah tersambung. Kredensial Google tidak pernah diketik di sini, dan itu
// perlu terlihat — layar yang meminta alamat dan sandi Gmail adalah bentuk
// yang sama persis dengan halaman pencurian kredensial.
//
// Dua hal yang sengaja ditampilkan meski tidak enak dibaca:
//
//   1. Apa yang benar-benar dibaca sistem, dan apa yang tidak. Pengguna
//      menyerahkan akses ke kotak masuknya; menyembunyikan cakupannya di balik
//      kalimat pemasaran adalah cara tercepat kehilangan kepercayaan yang
//      tidak akan kembali.
//   2. Alasan penolakan kandidat. "23 alamat ditemukan, 89 dilewati karena
//      tidak pernah dibalas" menjelaskan aturannya sekali, dan sesudah itu
//      tidak ada lagi pertanyaan kenapa kontaknya sedikit.

import { useState } from "react";
import { AlertTriangle, CheckCircle, Inbox, Loader2, RefreshCw, Unplug } from "lucide-react";
import { EmptyRow, ErrorRow, LoadingRow } from "./AsyncState";
import { Mono, Num, PanelLabel } from "./Typography";
import {
  ApiError,
  LABEL_TOLAK,
  getGmail,
  mulaiGmail,
  putusGmail,
  sinkronGmail,
  type KoneksiGmail as Koneksi,
} from "../lib/api";
import { useAsync } from "../lib/useAsync";

const pesanGalat = (err: unknown) =>
  err instanceof ApiError ? err.message : ((err as Error)?.message ?? "Galat tidak dikenal");

const waktu = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "belum pernah";

export function KoneksiGmail() {
  const { status, data, error, reload } = useAsync(() => getGmail(), []);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [hasil, setHasil] = useState<string | null>(null);

  async function sambungkan() {
    setSibuk(true);
    setGalat(null);
    try {
      const { url } = await mulaiGmail();
      // Berpindah penuh, bukan jendela sembulan. Halaman izin Google menolak
      // ditampilkan di dalam bingkai, dan jendela sembulan sering diblokir
      // peramban — keduanya berakhir sebagai tombol yang tampak rusak.
      window.location.href = url;
    } catch (err) {
      setGalat(pesanGalat(err));
      setSibuk(false);
    }
  }

  async function jalankan(aksi: () => Promise<unknown>, pesan?: (h: never) => string) {
    setSibuk(true);
    setGalat(null);
    setHasil(null);
    try {
      const h = (await aksi()) as never;
      if (pesan) setHasil(pesan(h));
      reload();
    } catch (err) {
      setGalat(pesanGalat(err));
    } finally {
      setSibuk(false);
    }
  }

  const koneksi = data?.koneksi ?? [];

  return (
    <div className="bg-card border border-border rounded-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Inbox size={14} style={{ color: "var(--primary)", flexShrink: 0, marginTop: 2 }} />
          <PanelLabel sub="Balasan kampanye tercatat sendiri, dan alamat yang pernah berkorespondensi dua arah masuk sebagai kontak">
            Kotak masuk Gmail
          </PanelLabel>
        </div>
        {data?.aktif && (
          <button
            onClick={sambungkan}
            disabled={sibuk}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs transition-colors flex-shrink-0 disabled:opacity-50"
            style={{ backgroundColor: "rgb(var(--primary-rgb) / 0.15)", color: "var(--primary)" }}
          >
            {sibuk ? <Loader2 size={12} className="animate-spin" /> : <Inbox size={12} />}
            Sambungkan Gmail
          </button>
        )}
      </div>

      {/* Cakupan akses, apa adanya. */}
      <div className="px-4 py-3 border-b border-border">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Anda akan diarahkan ke halaman izin milik Google. Kata sandi Gmail Anda tidak pernah
          diketik di sini dan tidak pernah kami simpan.
        </p>
        <div className="grid sm:grid-cols-2 gap-2 mt-2.5">
          <div>
            <div className="text-label uppercase font-semibold" style={{ color: "var(--sukses)" }}>
              Yang dibaca
            </div>
            <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
              <li>Alamat pengirim dan penerima</li>
              <li>Subjek dan waktu pesan</li>
              <li>Penanda balasan (In-Reply-To)</li>
            </ul>
          </div>
          <div>
            <div className="text-label uppercase font-semibold" style={{ color: "var(--samar)" }}>
              Yang tidak
            </div>
            <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
              <li>Isi pesan — tidak pernah diminta</li>
              <li>Lampiran</li>
              <li>Mengirim atau mengubah apa pun</li>
            </ul>
          </div>
        </div>
      </div>

      {!data?.aktif && data ? (
        <EmptyRow
          title="Integrasi Gmail belum dinyalakan di server"
          hint={data.catatan ?? "Isi GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, dan TOKEN_SECRET. Lihat docs/11-integrasi-gmail.md."}
        />
      ) : status === "gagal" && koneksi.length === 0 ? (
        <ErrorRow message={error} onRetry={reload} />
      ) : status === "memuat" && !data ? (
        <LoadingRow />
      ) : koneksi.length === 0 ? (
        <EmptyRow
          title="Belum ada kotak masuk tersambung"
          hint="Sambungkan kotak masuk tim penjualan — di situlah balasan kampanye mendarat, bukan di alamat sistem."
        />
      ) : (
        <div>
          {koneksi.map((k) => (
            <BarisKoneksi
              key={k.id}
              koneksi={k}
              sibuk={sibuk}
              onSinkron={() =>
                jalankan(
                  () => sinkronGmail(k.id),
                  (h: never) => {
                    const r = h as unknown as {
                      dibaca: number;
                      balasan: number;
                      kontakBaru: number;
                      ditolak: Record<string, number>;
                    };
                    const alasan = Object.entries(r.ditolak)
                      .filter(([, n]) => n > 0)
                      .map(([k2, n]) => `${n} ${LABEL_TOLAK[k2] ?? k2}`)
                      .join(", ");
                    return (
                      `${r.dibaca} pesan dibaca — ${r.balasan} balasan tercatat, ` +
                      `${r.kontakBaru} kontak baru` +
                      (alasan ? `. Dilewati: ${alasan}.` : ".")
                    );
                  },
                )
              }
              onPutus={() => jalankan(() => putusGmail(k.id))}
              onSambungUlang={sambungkan}
            />
          ))}
        </div>
      )}

      {(hasil || galat) && (
        <div className="px-4 py-2.5 border-t border-border">
          {hasil && (
            <p className="text-xs flex items-start gap-1.5" style={{ color: "var(--sukses)" }}>
              <CheckCircle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
              {hasil}
            </p>
          )}
          {galat && (
            <p className="text-xs" style={{ color: "var(--bahaya)" }}>
              {galat}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function BarisKoneksi({
  koneksi,
  sibuk,
  onSinkron,
  onPutus,
  onSambungUlang,
}: {
  koneksi: Koneksi;
  sibuk: boolean;
  onSinkron: () => void;
  onPutus: () => void;
  onSambungUlang: () => void;
}) {
  const perluSambungUlang = koneksi.status === "perlu_sambung_ulang";
  const dicabut = koneksi.status === "dicabut";

  return (
    <div className="px-4 py-3 border-b border-border last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Mono className="text-xs text-foreground">{koneksi.email}</Mono>
          <div className="text-xs text-muted-foreground mt-0.5">
            disambungkan {koneksi.terhubung_oleh} · sinkron terakhir {waktu(koneksi.last_sync_at)}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!dicabut && !perluSambungUlang && (
            <button
              onClick={onSinkron}
              disabled={sibuk}
              className="flex items-center gap-1.5 px-2 py-1 rounded-sm border border-border text-muted-foreground hover:text-foreground transition-colors text-xs disabled:opacity-40"
              title="Baca kotak masuk sekarang, tanpa menunggu putaran terjadwal"
            >
              {sibuk ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Sinkron
            </button>
          )}
          {!dicabut && (
            <button
              onClick={onPutus}
              disabled={sibuk}
              className="flex items-center gap-1.5 px-2 py-1 rounded-sm text-xs transition-colors disabled:opacity-40"
              style={{ backgroundColor: "rgb(var(--bahaya-rgb) / 0.12)", color: "var(--bahaya)" }}
              title="Cabut akses dari sisi Marketing Blast"
            >
              <Unplug size={11} /> Putus
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-4 mt-2">
        <span className="text-xs text-muted-foreground">
          <Num style={{ color: "var(--keterlibatan)" }}>{koneksi.balasan_tercatat}</Num> balasan
          tercatat
        </span>
        <span className="text-xs text-muted-foreground">
          <Num className="text-foreground">{koneksi.kontak_ditambahkan}</Num> kontak masuk
        </span>
      </div>

      {perluSambungUlang && (
        <div
          className="mt-2 rounded-sm px-2.5 py-2 flex items-start gap-2"
          style={{ backgroundColor: "rgb(var(--peringatan-rgb) / 0.12)" }}
        >
          <AlertTriangle
            size={12}
            style={{ color: "var(--peringatan)", flexShrink: 0, marginTop: 2 }}
          />
          <div className="text-xs" style={{ color: "var(--peringatan)" }}>
            <p className="leading-relaxed">
              Izin Gmail tidak berlaku lagi, jadi balasan berhenti tercatat sejak{" "}
              {waktu(koneksi.last_sync_at)}. Selama aplikasi ini masih berstatus uji di Google,
              izinnya memang kedaluwarsa tiap tujuh hari.
            </p>
            <button
              onClick={onSambungUlang}
              disabled={sibuk}
              className="mt-1.5 underline disabled:opacity-40"
            >
              Sambungkan ulang
            </button>
          </div>
        </div>
      )}

      {dicabut && (
        <p className="text-xs mt-2" style={{ color: "var(--samar)" }}>
          Koneksi ini sudah diputus. Catatannya disimpan sebagai jejak siapa pernah
          menyambungkan kotak masuk apa.
        </p>
      )}

      {koneksi.last_error && !perluSambungUlang && (
        <p className="text-xs mt-2" style={{ color: "var(--bahaya)" }}>
          Galat terakhir: {koneksi.last_error}
        </p>
      )}
    </div>
  );
}
