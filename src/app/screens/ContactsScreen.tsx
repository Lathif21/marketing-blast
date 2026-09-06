import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Eye, Search } from "lucide-react";
import { EmptyRow, ErrorRow, LoadingRow } from "../components/AsyncState";
import { ContactActionBar, type RingkasanPilihan } from "../components/ContactActionBar";
import { Pagination } from "../components/Pagination";
import { SectionTitle } from "../components/SectionTitle";
import { StatusBadge } from "../components/StatusBadge";
import { Th } from "../components/Th";
import { Mono, Num, Truncate } from "../components/Typography";
import { ApiError, activateContacts, listContacts, quarantineContacts } from "../lib/api";
import type { Contact } from "../lib/types";
import { QUARANTINE_REASON } from "../lib/mock";
import { CONSENT_LABELS, CONSENT_SOURCES, type ConsentSource, type ContactStatus } from "../lib/types";
import { useAsync } from "../lib/useAsync";

const FILTERS = ["semua", "aktif", "karantina", "diblokir"] as const;

export function ContactsScreen({ onNavigate }: { onNavigate?: (s: "import") => void }) {
  const [statusFilter, setStatusFilter] = useState<string>("semua");
  const [consentFilter, setConsentFilter] = useState<string>("semua");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  // Mengubah filter selalu mengembalikan ke halaman 1. Tanpa ini, menyaring
  // saat berada di halaman 12 akan mendarat di halaman kosong — pengguna
  // melihat "tidak ada kontak" padahal hasilnya ada, hanya di halaman lain.
  const gantiStatus = (nilai: string) => {
    setStatusFilter(nilai);
    setPage(1);
  };
  const gantiSumberIzin = (nilai: string) => {
    setConsentFilter(nilai);
    setPage(1);
  };
  const gantiPerHalaman = (nilai: number) => {
    setPerPage(nilai);
    setPage(1);
  };

  // Menunda pencarian supaya mengetik tidak memicu satu permintaan per huruf.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(
    () => ({
      status: statusFilter === "semua" ? undefined : (statusFilter as ContactStatus),
      consent_source:
        consentFilter === "semua" ? undefined : (consentFilter as ConsentSource),
      search: debounced.trim() || undefined,
      page,
      per_page: perPage,
    }),
    [statusFilter, consentFilter, debounced, page, perPage],
  );

  const { status, data, error, reload } = useAsync(() => listContacts(query), [query]);
  const items = data?.items ?? [];

  // ── Seleksi dan aktivasi ───────────────────────────────────────────────────
  const [terpilih, setTerpilih] = useState<Set<string>>(new Set());
  const [dinyatakanOleh, setDinyatakanOleh] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [kabar, setKabar] = useState<{ nada: "ok" | "galat"; teks: string } | null>(null);

  // Pilihan dibuang saat kumpulan datanya berganti. Menyimpan id dari halaman
  // sebelumnya berarti pengguna menekan "Aktifkan 40" sementara yang terlihat
  // di layar hanya 12 — jumlah yang tidak dapat mereka periksa.
  useEffect(() => {
    setTerpilih(new Set());
  }, [query]);

  const petaBaris = useMemo(() => new Map(items.map((c) => [c.id, c])), [items]);

  const pilihan: RingkasanPilihan = useMemo(() => {
    const dipilih = [...terpilih]
      .map((id) => petaBaris.get(id))
      .filter((c): c is Contact => Boolean(c));

    const karantina = dipilih.filter((c) => c.status === "karantina");
    return {
      total: dipilih.length,
      karantinaFound: karantina.filter((c) => c.emailOrigin !== "guessed").length,
      karantinaTebakan: karantina.filter((c) => c.emailOrigin === "guessed").length,
      aktif: dipilih.filter((c) => c.status === "aktif").length,
      tidakLayak: dipilih.filter((c) => c.status === "diblokir").length,
    };
  }, [terpilih, petaBaris]);

  const toggle = useCallback((id: string) => {
    setTerpilih((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const semuaTerpilih = items.length > 0 && items.every((c) => terpilih.has(c.id));
  const toggleSemua = () => {
    setTerpilih(semuaTerpilih ? new Set() : new Set(items.map((c) => c.id)));
  };

  const pesanGalat = (err: unknown) =>
    err instanceof ApiError ? err.message : ((err as Error)?.message ?? "Galat tidak dikenal");

  async function aktifkan(izinkanTebakan: boolean) {
    setSibuk(true);
    setKabar(null);
    try {
      const hasil = await activateContacts([...terpilih], dinyatakanOleh, izinkanTebakan);
      const r = hasil.ringkasan;
      // Yang ditolak ikut dilaporkan, bukan didiamkan. Aktivasi yang diam-diam
      // melewatkan sebagian membuat pengguna mengira semuanya berhasil.
      const catatan = [
        r.alamat_tebakan > 0 ? `${r.alamat_tebakan} alamat tebakan dilewati` : null,
        r.diblokir > 0 ? `${r.diblokir} diblokir` : null,
        r.ada_di_penekanan > 0 ? `${r.ada_di_penekanan} ada di daftar penekanan` : null,
        r.sudah_aktif > 0 ? `${r.sudah_aktif} sudah aktif` : null,
      ].filter(Boolean);

      setKabar({
        nada: "ok",
        teks:
          `${hasil.diaktifkan} kontak diaktifkan` +
          (catatan.length > 0 ? ` — ${catatan.join(", ")}` : ""),
      });
      setTerpilih(new Set());
      reload();
    } catch (err) {
      setKabar({ nada: "galat", teks: pesanGalat(err) });
    } finally {
      setSibuk(false);
    }
  }

  async function karantinakan() {
    setSibuk(true);
    setKabar(null);
    try {
      const hasil = await quarantineContacts([...terpilih]);
      setKabar({ nada: "ok", teks: `${hasil.dikarantina} kontak dikembalikan ke karantina` });
      setTerpilih(new Set());
      reload();
    } catch (err) {
      setKabar({ nada: "galat", teks: pesanGalat(err) });
    } finally {
      setSibuk(false);
    }
  }
  const adaFilter = statusFilter !== "semua" || consentFilter !== "semua" || debounced.trim() !== "";

  // Jaring pengaman kalau jumlah data menyusut di luar aksi pengguna —
  // misalnya kontak terhapus lewat pembatalan batch di layar lain.
  const totalHalaman = data ? Math.max(Math.ceil(data.total / perPage), 1) : 1;
  useEffect(() => {
    if (data && page > totalHalaman) setPage(totalHalaman);
  }, [data, page, totalHalaman]);

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-4 gap-4">
        <div>
          <SectionTitle label="Daftar Kontak" />
          <p className="text-sm text-muted-foreground max-w-3xl">
            {data ? (
              <>
                <Num>{data.total.toLocaleString("id-ID")}</Num> kontak cocok dengan filter saat ini
              </>
            ) : (
              "Memuat…"
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
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
          <select
            value={consentFilter}
            onChange={(e) => gantiSumberIzin(e.target.value)}
            className="bg-card border border-border rounded-sm px-2 py-1.5 text-xs text-foreground outline-none"
          >
            <option value="semua">Semua sumber izin</option>
            {CONSENT_SOURCES.map((c) => (
              <option key={c} value={c}>
                {CONSENT_LABELS[c]}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => gantiStatus(f)}
                className="px-2.5 py-1.5 text-xs rounded-sm capitalize transition-all"
                style={{
                  backgroundColor: statusFilter === f ? "var(--primary)" : "rgb(var(--kabut-rgb) / 0.07)",
                  color: statusFilter === f ? "var(--primary-foreground)" : "var(--secondary-foreground)",
                  border: `1px solid ${statusFilter === f ? "var(--primary)" : "rgb(var(--kabut-rgb) / 0.12)"}`,
                }}
              >
                {f === "semua" ? "Semua" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {kabar && (
        <div
          className="rounded-sm p-3 mb-3 text-xs border"
          style={{
            backgroundColor: kabar.nada === "ok" ? "rgb(var(--sukses-rgb) / 0.12)" : "rgb(var(--bahaya-rgb) / 0.14)",
            borderColor: kabar.nada === "ok" ? "rgb(var(--sukses-rgb) / 0.3)" : "rgb(var(--bahaya-rgb) / 0.28)",
            color: kabar.nada === "ok" ? "var(--sukses)" : "var(--bahaya)",
          }}
        >
          {kabar.teks}
        </div>
      )}

      {pilihan.total > 0 && (
        <ContactActionBar
          pilihan={pilihan}
          dinyatakanOleh={dinyatakanOleh}
          onDinyatakanOleh={setDinyatakanOleh}
          onAktifkan={(izin) => void aktifkan(izin)}
          onKarantinakan={() => void karantinakan()}
          onBersihkan={() => setTerpilih(new Set())}
          sibuk={sibuk}
        />
      )}

      <div className="bg-card border border-border rounded-sm overflow-hidden">
        {status === "gagal" && items.length === 0 ? (
          <ErrorRow message={error} onRetry={reload} />
        ) : status === "memuat" && items.length === 0 ? (
          <LoadingRow />
        ) : items.length === 0 ? (
          adaFilter ? (
            <EmptyRow
              title="Tidak ada kontak yang cocok"
              hint="Longgarkan filter atau kosongkan kolom pencarian."
              action={
                <button
                  onClick={() => {
                    setStatusFilter("semua");
                    setConsentFilter("semua");
                    setSearch("");
                    setPage(1);
                  }}
                  className="px-3 py-1.5 text-xs border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Bersihkan filter
                </button>
              }
            />
          ) : (
            <EmptyRow
              title="Belum ada kontak"
              hint="Impor daftar kontak dari berkas CSV atau keluaran terenkripsi Contact Harvester untuk mulai menyusun kampanye."
              action={
                onNavigate && (
                  <button
                    onClick={() => onNavigate("import")}
                    className="px-3 py-1.5 text-xs rounded-sm"
                    style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}
                  >
                    Impor Kontak
                  </button>
                )
              }
            />
          )
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={semuaTerpilih}
                    onChange={toggleSemua}
                    aria-label="Pilih semua di halaman ini"
                  />
                </th>
                <Th>Perusahaan</Th>
                <Th>Email</Th>
                <Th>Sumber Izin</Th>
                <Th>Status</Th>
                <Th>Tanggal Impor</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors"
                  style={{
                    backgroundColor:
                      c.status === "karantina"
                        ? "rgb(var(--peringatan-rgb) / 0.05)"
                        : c.status === "diblokir"
                          ? "rgb(var(--bahaya-rgb) / 0.05)"
                          : undefined,
                    borderLeft:
                      c.status === "karantina"
                        ? "2px solid rgb(var(--peringatan-rgb) / 0.45)"
                        : c.status === "diblokir"
                          ? "2px solid rgb(var(--bahaya-rgb) / 0.45)"
                          : "2px solid transparent",
                  }}
                >
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={terpilih.has(c.id)}
                      onChange={() => toggle(c.id)}
                      aria-label={`Pilih ${c.company}`}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-foreground">
                    <Truncate maxWidth="260px">{c.company}</Truncate>
                  </td>
                  <td className="px-3 py-2.5">
                    <Mono className="text-muted-foreground">{c.email}</Mono>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{CONSENT_LABELS[c.consent]}</td>
                  <td className="px-3 py-2.5">
                    {/*
                      Peringatan dipicu asal alamat, bukan sumber izin. Alamat hasil
                      tebakan adalah penyebab utama pemantulan keras — itulah yang
                      membuat kontak dikarantina (04-aturan-kepatuhan.md §4).
                    */}
                    <span className="inline-flex items-center gap-1.5">
                      <StatusBadge status={c.status} />
                      {c.emailOrigin === "guessed" && (
                        <span className="inline-flex" title={QUARANTINE_REASON}>
                          <AlertTriangle size={11} style={{ color: "var(--peringatan)", flexShrink: 0 }} />
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <Num className="text-muted-foreground">{c.date}</Num>
                  </td>
                  <td className="px-3 py-2.5">
                    <button className="text-muted-foreground hover:text-foreground transition-colors">
                      <Eye size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/*
        Paginasi hanya muncul kalau data sudah pernah berhasil dimuat.
        Menampilkannya saat gagal total berarti menawarkan navigasi ke halaman
        yang isinya tidak diketahui.
      */}
      {data && (
        <Pagination
          page={page}
          perPage={perPage}
          total={data.total}
          onPageChange={setPage}
          onPerPageChange={gantiPerHalaman}
          disabled={status === "memuat"}
          satuan="kontak"
        />
      )}

      {status === "gagal" && items.length > 0 && (
        <p className="mt-2 text-xs" style={{ color: "var(--peringatan)" }}>
          Gagal menyegarkan: {error}. Yang tampil di atas adalah data terakhir yang berhasil dimuat.
        </p>
      )}
    </div>
  );
}
