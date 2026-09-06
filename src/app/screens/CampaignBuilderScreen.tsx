// Penyusun kampanye.
//
// Penerima dipilih satu per satu, bukan lewat segmen berukuran ribuan.
// Alasannya praktis: domain dalam masa pemanasan hanya boleh mengirim puluhan
// email per hari, jadi memilih seluruh basis kontak lalu ditahan pra-kirim
// bukan alur yang berguna. Memilih sebanyak yang muat hari ini adalah yang
// benar-benar dilakukan pengguna.
//
// Yang memutuskan boleh-tidaknya mengirim tetap server. Layar ini menampilkan
// sisa kuota lebih awal supaya keputusan diambil sebelum menulis pesan, bukan
// supaya UI menggantikan pemeriksaan pra-kirim.

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Loader2,
  Search,
  Send,
  Shield,
  XCircle,
} from "lucide-react";
import { EmptyRow, ErrorRow, LoadingRow } from "../components/AsyncState";
import { Pagination } from "../components/Pagination";
import { SectionTitle } from "../components/SectionTitle";
import { StepBar } from "../components/StepBar";
import { Mono, Num, PanelLabel, Truncate } from "../components/Typography";
import { Th } from "../components/Th";
import { BarisSubjek } from "../components/BarisSubjek";
import {
  ApiError,
  createCampaign,
  listContacts,
  preflightCampaign,
  sendCampaign,
  type HasilPreflight,
} from "../lib/api";
import { useDomainHealth } from "../lib/domainHealth";
import { useAsync } from "../lib/useAsync";
import { CONSENT_LABELS, type BuilderStep, type Contact } from "../lib/types";

const VARIABLES = ["{{nama_perusahaan}}"];

const DEFAULT_SUBJECT = "Penawaran Solusi untuk {{nama_perusahaan}}";
const DEFAULT_BODY = [
  "Yth. Tim Pengadaan {{nama_perusahaan}},",
  "",
  "Perkenalkan, kami ingin menyampaikan solusi yang telah membantu perusahaan",
  "sejenis meningkatkan efisiensi operasional.",
  "",
  "Apakah Bapak/Ibu bersedia untuk jadwal perkenalan 20 menit minggu ini?",
].join("\n");

/**
 * Label untuk setiap butir pemeriksaan. Harus mencakup SELURUH `ButirId` di
 * `apps/api/src/campaign/preflight.ts` — butir yang tidak ada di sini tampil
 * sebagai kunci mentah seperti `penerima_ada`, yang tidak berarti apa pun bagi
 * pengguna.
 */
const LABEL_BUTIR: Record<string, string> = {
  identitas_pengirim: "Identitas pengirim tercantum",
  tautan_berhenti: "Tautan berhenti berlangganan tersisip",
  penekanan_dikeluarkan: "Kontak di daftar penekanan dikeluarkan",
  karantina_dikeluarkan: "Kontak karantina dikeluarkan",
  penerima_ada: "Ada penerima yang dapat dikirimi",
  batas_pemanasan: "Volume dalam batas pemanasan",
  penanda_terisi: "Semua penanda personalisasi terisi",
};

export function CampaignBuilderScreen({ onNavigate }: { onNavigate?: (s: "contacts") => void }) {
  const [step, setStep] = useState<BuilderStep>(1);
  const [nama, setNama] = useState("Kampanye " + new Date().toLocaleDateString("id-ID"));
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);

  const { data: health } = useDomainHealth();
  const sisaKuota = health?.warmup.remaining_today ?? null;
  const pengirim = health?.sender;

  // ── Pemilihan penerima ─────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [terpilih, setTerpilih] = useState<Map<string, Contact>>(new Map());

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(
    () => ({
      // Hanya kontak aktif yang dapat dikirimi. Menampilkan yang karantina di
      // sini hanya menawarkan pilihan yang akan ditolak server.
      status: "aktif" as const,
      search: debounced.trim() || undefined,
      page,
      per_page: perPage,
    }),
    [debounced, page, perPage],
  );

  const { status, data, error, reload } = useAsync(() => listContacts(query), [query]);
  const items = data?.items ?? [];

  // Pilihan disimpan sebagai Map, bukan Set berisi id, supaya bertahan saat
  // pindah halaman — pengguna memilih 20 dari halaman 1 lalu 10 dari halaman 3,
  // dan keduanya harus tetap terhitung.
  const jumlahDipilih = terpilih.size;
  const melebihiKuota = sisaKuota !== null && jumlahDipilih > sisaKuota;

  const toggle = (c: Contact) => {
    setTerpilih((prev) => {
      const next = new Map(prev);
      if (next.has(c.id)) next.delete(c.id);
      else next.set(c.id, c);
      return next;
    });
  };

  const halamanIniSemua = items.length > 0 && items.every((c) => terpilih.has(c.id));
  const toggleHalaman = () => {
    setTerpilih((prev) => {
      const next = new Map(prev);
      if (halamanIniSemua) items.forEach((c) => next.delete(c.id));
      else items.forEach((c) => next.set(c.id, c));
      return next;
    });
  };

  /** Menambah dari halaman ini sampai kuota terisi, lalu berhenti. */
  const penuhiKuota = () => {
    if (sisaKuota === null) return;
    setTerpilih((prev) => {
      const next = new Map(prev);
      for (const c of items) {
        if (next.size >= sisaKuota) break;
        next.set(c.id, c);
      }
      return next;
    });
  };

  // ── Kirim ──────────────────────────────────────────────────────────────────
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [cek, setCek] = useState<HasilPreflight | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [terkirim, setTerkirim] = useState<{ diantrekan: number; catatan: string } | null>(null);

  const pesanGalat = (err: unknown) =>
    err instanceof ApiError ? err.message : ((err as Error)?.message ?? "Galat tidak dikenal");

  /** Membuat draf lalu menjalankan pemeriksaan pra-kirim di server. */
  async function tinjau() {
    setSibuk(true);
    setGalat(null);
    try {
      const c = await createCampaign({
        name: nama.trim() || "Tanpa nama",
        subject,
        body_text: body,
        contact_ids: [...terpilih.keys()],
      });
      setCampaignId(c.id);
      setCek(await preflightCampaign(c.id));
      setStep(3);
    } catch (err) {
      setGalat(pesanGalat(err));
    } finally {
      setSibuk(false);
    }
  }

  async function kirim() {
    if (!campaignId) return;
    setSibuk(true);
    setGalat(null);
    try {
      const hasil = await sendCampaign(campaignId);
      setTerkirim({ diantrekan: hasil.diantrekan, catatan: hasil.catatan });
    } catch (err) {
      setGalat(pesanGalat(err));
    } finally {
      setSibuk(false);
    }
  }

  const render = (teks: string) => {
    const contoh = [...terpilih.values()][0];
    return teks.replace(/\{\{nama_perusahaan\}\}/g, contoh?.company ?? "{{nama_perusahaan}}");
  };

  /** Baris pertama yang tidak kosong — itulah yang jadi cuplikan di kotak masuk. */
  const barisPertama = (teks: string) =>
    teks.split(/\r?\n/).find((b) => b.trim()) ?? "";

  const fmt = (n: number) => n.toLocaleString("id-ID");
  const bolehLanjut = jumlahDipilih > 0 && !melebihiKuota;

  return (
    <div className="p-6 max-w-5xl">
      <StepBar steps={["Pilih Penerima", "Tulis Pesan", "Tinjau & Kirim"]} current={step} />

      {galat && (
        <div
          className="rounded-sm p-3 mb-4 flex items-start gap-2 border"
          style={{ backgroundColor: "rgb(var(--bahaya-rgb) / 0.14)", borderColor: "rgb(var(--bahaya-rgb) / 0.28)" }}
        >
          <XCircle size={14} style={{ color: "var(--bahaya)", flexShrink: 0, marginTop: 1 }} />
          <p className="text-xs" style={{ color: "var(--bahaya)" }}>
            {galat}
          </p>
        </div>
      )}

      {/* ── Langkah 1: pilih penerima ── */}
      {step === 1 && (
        <div className="space-y-3">
          <SectionTitle
            label="Pilih Penerima"
            sub="Centang kontak yang akan dikirimi. Hanya kontak berstatus aktif yang dapat dipilih."
          />

          {/* Kuota ditampilkan sebelum memilih, bukan setelah ditolak. */}
          <div
            className="rounded-sm p-3 flex items-center justify-between gap-3 flex-wrap border"
            style={{
              backgroundColor: melebihiKuota ? "rgb(var(--bahaya-rgb) / 0.12)" : "rgb(var(--kabut-rgb) / 0.06)",
              borderColor: melebihiKuota ? "rgb(var(--bahaya-rgb) / 0.3)" : "rgb(var(--kabut-rgb) / 0.16)",
            }}
          >
            <div className="flex items-center gap-2">
              <Shield
                size={12}
                style={{ color: melebihiKuota ? "var(--bahaya)" : "var(--primary)", flexShrink: 0 }}
              />
              <span className="text-xs text-muted-foreground">
                <span className="text-foreground">
                  <Num>{fmt(jumlahDipilih)}</Num> dipilih
                </span>
                {" · sisa kuota hari ini "}
                <span className="text-foreground">
                  {sisaKuota === null ? "tanpa batas" : <Num>{fmt(sisaKuota)}</Num>}
                </span>
                {health && (
                  <>
                    {" · tahap pemanasan "}
                    <Num>
                      {health.warmup.stage}/{health.warmup.total_stages}
                    </Num>
                  </>
                )}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {sisaKuota !== null && jumlahDipilih < sisaKuota && items.length > 0 && (
                <button
                  onClick={penuhiKuota}
                  className="px-2.5 py-1 text-xs border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Penuhi kuota
                </button>
              )}
              {jumlahDipilih > 0 && (
                <button
                  onClick={() => setTerpilih(new Map())}
                  className="px-2.5 py-1 text-xs border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Kosongkan
                </button>
              )}
            </div>
          </div>

          {melebihiKuota && sisaKuota !== null && (
            <div
              className="rounded-sm p-3 flex items-start gap-2 border"
              style={{
                backgroundColor: "rgb(var(--bahaya-rgb) / 0.12)",
                borderColor: "rgb(var(--bahaya-rgb) / 0.28)",
              }}
            >
              <AlertTriangle size={13} style={{ color: "var(--bahaya)", flexShrink: 0, marginTop: 1 }} />
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span style={{ color: "var(--bahaya)" }}>
                  Pilihan melebihi kuota harian sebanyak{" "}
                  <Num>{fmt(jumlahDipilih - sisaKuota)}</Num> kontak.
                </span>{" "}
                Kurangi pilihan hingga <Num>{fmt(sisaKuota)}</Num>, atau kirim sisanya sebagai
                kampanye terpisah besok. Batas ini menjaga reputasi domain saat masih dalam masa
                pemanasan — melampauinya mempercepat kerusakan, bukan mempercepat hasil.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 justify-end">
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                placeholder="Cari perusahaan atau email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-card border border-border rounded-sm pl-7 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none w-64"
                style={{ caretColor: "var(--primary)" }}
              />
            </div>
          </div>

          <div className="bg-card border border-border rounded-sm overflow-hidden">
            {status === "gagal" && items.length === 0 ? (
              <ErrorRow message={error} onRetry={reload} />
            ) : status === "memuat" && items.length === 0 ? (
              <LoadingRow />
            ) : items.length === 0 ? (
              <EmptyRow
                title="Belum ada kontak aktif"
                hint="Kampanye hanya dapat dikirim ke kontak berstatus aktif. Kontak hasil impor masuk karantina sampai diaktifkan di Daftar Kontak."
                action={
                  onNavigate && (
                    <button
                      onClick={() => onNavigate("contacts")}
                      className="px-3 py-1.5 text-xs rounded-sm"
                      style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}
                    >
                      Buka Daftar Kontak
                    </button>
                  )
                }
              />
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={halamanIniSemua}
                        onChange={toggleHalaman}
                        aria-label="Pilih semua di halaman ini"
                      />
                    </th>
                    <Th>Perusahaan</Th>
                    <Th>Email</Th>
                    <Th>Sumber Izin</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => toggle(c)}
                      className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors cursor-pointer"
                      style={{
                        backgroundColor: terpilih.has(c.id) ? "rgb(var(--primary-rgb) / 0.07)" : undefined,
                      }}
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={terpilih.has(c.id)}
                          onChange={() => toggle(c)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Pilih ${c.company}`}
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-foreground">
                        <Truncate maxWidth="280px">{c.company}</Truncate>
                      </td>
                      <td className="px-3 py-2.5">
                        <Mono className="text-muted-foreground">{c.email}</Mono>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {CONSENT_LABELS[c.consent]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {data && (
            <Pagination
              page={page}
              perPage={perPage}
              total={data.total}
              onPageChange={setPage}
              onPerPageChange={(n) => {
                setPerPage(n);
                setPage(1);
              }}
              disabled={status === "memuat"}
              satuan="kontak aktif"
            />
          )}

          <div className="flex justify-end">
            <button
              onClick={() => setStep(2)}
              disabled={!bolehLanjut}
              title={
                jumlahDipilih === 0
                  ? "Pilih minimal satu penerima"
                  : melebihiKuota
                    ? "Kurangi pilihan agar muat dalam kuota harian"
                    : undefined
              }
              className="px-4 py-2 text-xs rounded-sm flex items-center gap-2 transition-all"
              style={{
                backgroundColor: bolehLanjut ? "var(--primary)" : "rgb(var(--kabut-rgb) / 0.1)",
                color: bolehLanjut ? "var(--primary-foreground)" : "var(--muted-foreground)",
                cursor: bolehLanjut ? "pointer" : "not-allowed",
              }}
            >
              Lanjut: Tulis Pesan <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── Langkah 2: tulis pesan ── */}
      {step === 2 && (
        <div className="space-y-4">
          <SectionTitle
            label="Tulis Pesan"
            sub="Pratinjau dirender dari kontak pertama yang Anda pilih."
          />

          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-3">
              <div>
                <PanelLabel className="mb-1">Nama kampanye</PanelLabel>
                <input
                  type="text"
                  value={nama}
                  onChange={(e) => setNama(e.target.value)}
                  className="w-full bg-card border border-border rounded-sm px-3 py-2 text-xs text-foreground outline-none"
                  style={{ caretColor: "var(--primary)" }}
                />
              </div>

              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-xs text-muted-foreground mr-1">Variabel:</span>
                {VARIABLES.map((v) => (
                  <button
                    key={v}
                    onClick={() => setBody((b) => `${b} ${v}`)}
                    className="px-1.5 py-0.5 text-xs font-mono rounded-sm transition-colors"
                    style={{
                      backgroundColor: "rgb(var(--primary-rgb) / 0.13)",
                      color: "var(--primary)",
                      border: "1px solid rgb(var(--primary-rgb) / 0.28)",
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>

              <BarisSubjek
                nilai={subject}
                onUbah={setSubject}
                pratinjau={render(subject)}
                namaPengirim={pengirim?.name ?? "Pengirim"}
                cuplikan={barisPertama(render(body))}
              />

              <div>
                <PanelLabel className="mb-1">Isi pesan</PanelLabel>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={12}
                  className="w-full bg-card border border-border rounded-sm px-3 py-2 text-xs text-foreground outline-none resize-none leading-relaxed"
                  style={{ caretColor: "var(--primary)" }}
                />
              </div>
            </div>

            <div>
              <PanelLabel className="mb-1">Pratinjau langsung</PanelLabel>
              <div className="bg-secondary/20 border border-border rounded-sm overflow-hidden">
                <div
                  className="border-b border-border px-4 py-2.5 space-y-1"
                  style={{ backgroundColor: "rgb(var(--kabut-rgb) / 0.05)" }}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground w-14 flex-shrink-0">Dari:</span>
                    <span className="text-xs text-foreground break-all">
                      {pengirim ? (
                        <>
                          {pengirim.name} &lt;<Mono>{pengirim.address}</Mono>&gt;
                        </>
                      ) : (
                        "memuat…"
                      )}
                    </span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground w-14 flex-shrink-0">Ke:</span>
                    <Mono className="text-xs text-foreground break-all">
                      {[...terpilih.values()][0]?.email ?? "—"}
                    </Mono>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground w-14 flex-shrink-0">Subjek:</span>
                    <span className="text-xs text-foreground break-words">{render(subject)}</span>
                  </div>
                </div>
                <div className="px-4 py-3">
                  <pre
                    className="text-xs text-foreground whitespace-pre-wrap leading-relaxed"
                    style={{ fontFamily: "inherit" }}
                  >
                    {render(body)}
                  </pre>
                  {/*
                    Footer ditampilkan sebagai bagian pratinjau karena memang
                    selalu ikut terkirim. Ia disisipkan server dan tidak dapat
                    dihapus dari editor.
                  */}
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-xs text-muted-foreground">
                      Tidak ingin menerima email ini?{" "}
                      <span style={{ color: "var(--primary)", textDecoration: "underline" }}>
                        Berhenti berlangganan
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {pengirim ? `${pengirim.name} · ${pengirim.postal_address}` : ""}
                    </p>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                Identitas pengirim dan tautan berhenti berlangganan disisipkan di server. Keduanya
                tidak dapat dihapus dari editor.
              </p>
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2 text-xs border border-border rounded-sm text-muted-foreground flex items-center gap-2 hover:text-foreground transition-colors"
            >
              <ArrowLeft size={13} /> Kembali
            </button>
            <button
              onClick={() => void tinjau()}
              disabled={sibuk}
              className="px-4 py-2 text-xs rounded-sm flex items-center gap-2"
              style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}
            >
              {sibuk ? <Loader2 size={13} className="animate-spin" /> : null}
              Tinjau Kampanye <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* ── Langkah 3: tinjau & kirim ── */}
      {step === 3 && cek && (
        <div className="space-y-4">
          <SectionTitle
            label="Tinjau & Kirim"
            sub="Hasil pemeriksaan di bawah datang dari server. Butir yang gagal memblokir pengiriman."
          />

          {terkirim ? (
            <div
              className="rounded-sm p-4 flex items-start gap-3 border"
              style={{ backgroundColor: "rgb(var(--sukses-rgb) / 0.12)", borderColor: "rgb(var(--sukses-rgb) / 0.3)" }}
            >
              <CheckCircle size={16} style={{ color: "var(--sukses)", flexShrink: 0, marginTop: 1 }} />
              <div>
                <p className="text-xs text-foreground mb-1">
                  <Num>{fmt(terkirim.diantrekan)}</Num> penerima masuk antrean.
                </p>
                <p className="text-xs text-muted-foreground">{terkirim.catatan}</p>
              </div>
            </div>
          ) : (
            <>
              {!cek.dapat_dikirim && (
                <div
                  className="rounded-sm p-4 flex items-start gap-3 border"
                  style={{
                    backgroundColor: "rgb(var(--bahaya-rgb) / 0.14)",
                    borderColor: "rgb(var(--bahaya-rgb) / 0.28)",
                  }}
                >
                  <XCircle size={16} style={{ color: "var(--bahaya)", flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <p
                      className="text-sm font-semibold uppercase tracking-wide mb-1"
                      style={{
                        fontFamily: "'Barlow Condensed', sans-serif",
                        color: "var(--bahaya)",
                        letterSpacing: "0.08em",
                      }}
                    >
                      Kampanye Ditahan
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Ada butir pemeriksaan yang gagal. Perbaiki dulu — daftar di bawah menyebutkan
                      yang mana.
                      {cek.ringkasan.tanggal_muat && (
                        <>
                          {" "}
                          Kalau penyebabnya kuota, seluruh pilihan ini muat paling cepat pada{" "}
                          <Num>{cek.ringkasan.tanggal_muat}</Num>.
                        </>
                      )}
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-card border border-border rounded-sm p-4">
                  <PanelLabel className="mb-3">Ringkasan</PanelLabel>
                  {[
                    { label: "Nama", value: nama },
                    { label: "Penerima layak kirim", value: fmt(cek.ringkasan.layak_kirim) },
                    { label: "Dikeluarkan (penekanan)", value: fmt(cek.ringkasan.tersuppress) },
                    { label: "Dikeluarkan (karantina)", value: fmt(cek.ringkasan.terkarantina) },
                    {
                      label: "Sisa kuota hari ini",
                      value:
                        cek.ringkasan.sisa_kuota === null
                          ? "tanpa batas"
                          : fmt(cek.ringkasan.sisa_kuota),
                    },
                    { label: "Tahap pemanasan", value: `${cek.ringkasan.tahap_pemanasan}` },
                  ].map(({ label, value }) => (
                    <div
                      key={label}
                      className="flex justify-between gap-3 py-1.5 border-b border-border last:border-0 text-xs"
                    >
                      <span className="text-muted-foreground flex-shrink-0">{label}</span>
                      <span className="text-foreground text-right">{value}</span>
                    </div>
                  ))}
                </div>

                <div className="bg-card border border-border rounded-sm p-4">
                  <PanelLabel className="mb-3">Daftar kepatuhan</PanelLabel>
                  <div className="space-y-2.5">
                    {cek.pemeriksaan.map((b) => (
                      <div key={b.butir} className="flex items-start gap-2">
                        {b.lolos ? (
                          <CheckCircle
                            size={13}
                            style={{ color: "var(--sukses)", flexShrink: 0, marginTop: 1 }}
                          />
                        ) : b.peringatan ? (
                          <AlertTriangle
                            size={13}
                            style={{ color: "var(--peringatan)", flexShrink: 0, marginTop: 1 }}
                          />
                        ) : (
                          <XCircle
                            size={13}
                            style={{ color: "var(--bahaya)", flexShrink: 0, marginTop: 1 }}
                          />
                        )}
                        <div>
                          <p
                            className="text-xs"
                            style={{
                              color: b.lolos ? "var(--foreground)" : b.peringatan ? "var(--peringatan)" : "var(--bahaya)",
                            }}
                          >
                            {LABEL_BUTIR[b.butir] ?? b.butir}
                          </p>
                          {(b.pesan || b.jumlah !== undefined) && (
                            <p className="text-xs text-muted-foreground">
                              {b.pesan ?? `${fmt(b.jumlah ?? 0)} kontak`}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => setStep(2)}
                  className="px-4 py-2 text-xs border border-border rounded-sm text-muted-foreground flex items-center gap-2 hover:text-foreground transition-colors"
                >
                  <ArrowLeft size={13} /> Kembali
                </button>
                <button
                  onClick={() => void kirim()}
                  disabled={!cek.dapat_dikirim || sibuk}
                  className="px-6 py-2 text-xs rounded-sm flex items-center gap-2 transition-all"
                  style={{
                    backgroundColor: cek.dapat_dikirim && !sibuk ? "var(--sukses-kuat)" : "rgb(var(--bahaya-rgb) / 0.25)",
                    color: cek.dapat_dikirim && !sibuk ? "var(--primary-foreground)" : "var(--bahaya)",
                    cursor: cek.dapat_dikirim && !sibuk ? "pointer" : "not-allowed",
                  }}
                >
                  {sibuk ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  {cek.dapat_dikirim ? (
                    <>
                      Kirim ke <Num>{fmt(cek.ringkasan.layak_kirim)}</Num> Penerima
                    </>
                  ) : (
                    "Pengiriman Ditahan"
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
