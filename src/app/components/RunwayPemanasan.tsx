// Runway pemanasan domain — Revisi 3 di 05-revisi-desain.md.
//
// Menggantikan tiga hal yang dulu terpisah — tahap saat ini, batas harian, dan
// sisa hari ini — dengan satu gambar yang menjawab ketiganya sekaligus:
//
//   di mana domain ini sekarang, ke mana arahnya, dan berapa lagi hari ini.
//
// Yang dituju bukan keindahan. Saat kampanye besar tertahan pra-kirim, jawaban
// "melebihi sisa kuota" hanya terasa sebagai penolakan. Runway membuat
// alasannya terlihat: tahap 2 dari 5, batasnya memang 100 sehari, dan tahap
// berikutnya menunggu metrik yang sehat — bukan aturan sewenang-wenang.
//
// Angka tiap tahap datang dari server (`warmup.jadwal`), tidak ditulis ulang di
// sini. Batas harian adalah aturan yang ditegakkan; dua salinan yang berbeda
// berarti yang ditampilkan bukan yang berlaku.
//
// Kenaikan tahap sengaja TIDAK digambarkan sebagai jadwal otomatis. Tahap naik
// hanya bila bounce dan keluhan aman (04-aturan-kepatuhan.md §3), jadi tahap di
// depan ditandai "menunggu metrik sehat" — bukan tanggal.

import { Num, PanelLabel } from "./Typography";

export interface TahapRunway {
  stage: number;
  daily_limit: number | null;
  hari_paling_cepat: number;
}

const angka = (n: number) => n.toLocaleString("id-ID");

export function RunwayPemanasan({
  jadwal,
  tahapSekarang,
  terpakaiHariIni,
  sisaHariIni,
  batasHariIni,
}: {
  jadwal: TahapRunway[];
  tahapSekarang: number;
  terpakaiHariIni: number;
  sisaHariIni: number | null;
  batasHariIni: number | null;
}) {
  return (
    <div className="bg-card border border-border rounded-sm p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <PanelLabel>Runway pemanasan domain</PanelLabel>
        <span className="text-xs text-muted-foreground">
          Tahap <Num className="text-foreground font-semibold">{tahapSekarang}</Num> dari{" "}
          <Num>{jadwal.length}</Num>
        </span>
      </div>

      <div className="flex gap-1.5">
        {jadwal.map((t) => {
          const selesai = t.stage < tahapSekarang;
          const sekarang = t.stage === tahapSekarang;

          // Hanya tahap yang sedang berjalan yang menunjukkan pemakaian.
          // Tahap yang sudah lewat terisi penuh, yang di depan kosong —
          // menampilkan kemajuan pada tahap yang belum dimasuki akan
          // menyiratkan jadwal yang berjalan sendiri.
          const isi =
            selesai || (sekarang && batasHariIni === null)
              ? 100
              : sekarang && batasHariIni
                ? Math.min((terpakaiHariIni / batasHariIni) * 100, 100)
                : 0;

          return (
            <div key={t.stage} className="flex-1 min-w-0">
              <div
                className="h-2 rounded-sm overflow-hidden"
                style={{
                  backgroundColor: sekarang
                    ? "rgb(var(--primary-rgb) / 0.2)"
                    : "rgb(var(--kabut-rgb) / 0.14)",
                  outline: sekarang ? "1px solid rgb(var(--primary-rgb) / 0.45)" : "none",
                  outlineOffset: "1px",
                }}
              >
                <div
                  className="h-full transition-[width] duration-500"
                  style={{
                    width: `${isi}%`,
                    backgroundColor: selesai
                      ? "rgb(var(--primary-rgb) / 0.55)"
                      : "var(--primary)",
                  }}
                />
              </div>

              <div className="mt-1.5 truncate">
                <Num
                  className="text-xs"
                  style={{
                    color: sekarang ? "var(--foreground)" : "var(--muted-foreground)",
                    fontWeight: sekarang ? 600 : 400,
                  }}
                >
                  {t.daily_limit === null ? "penuh" : `${angka(t.daily_limit)}/hari`}
                </Num>
              </div>
              <div className="text-label truncate" style={{ color: "var(--samar)" }}>
                {selesai ? "selesai" : sekarang ? "berjalan" : `hari ${t.hari_paling_cepat}+`}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
        {batasHariIni === null ? (
          <>Tahap terakhir — tidak ada batas harian tetap.</>
        ) : (
          <>
            <Num className="text-foreground font-semibold">{angka(sisaHariIni ?? 0)}</Num> dari{" "}
            <Num>{angka(batasHariIni)}</Num> tersisa hari ini.{" "}
            {tahapSekarang < jadwal.length && (
              <>
                Tahap berikutnya membuka{" "}
                <Num>
                  {jadwal[tahapSekarang]?.daily_limit === null
                    ? "volume penuh"
                    : `${angka(jadwal[tahapSekarang]?.daily_limit ?? 0)}/hari`}
                </Num>{" "}
                — terbuka saat pemantulan dan keluhan tetap aman, bukan karena hari berganti.
              </>
            )}
          </>
        )}
      </p>
    </div>
  );
}
