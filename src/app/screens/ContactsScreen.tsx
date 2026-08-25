import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Eye, Search } from "lucide-react";
import { EmptyRow, ErrorRow, LoadingRow } from "../components/AsyncState";
import { Pagination } from "../components/Pagination";
import { SectionTitle } from "../components/SectionTitle";
import { StatusBadge } from "../components/StatusBadge";
import { Th } from "../components/Th";
import { Mono, Num, Truncate } from "../components/Typography";
import { listContacts } from "../lib/api";
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
          <p className="text-xs text-muted-foreground -mt-3">
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
              style={{ caretColor: "#c4824a" }}
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
                  backgroundColor: statusFilter === f ? "#c4824a" : "rgba(100,140,180,0.07)",
                  color: statusFilter === f ? "#fff" : "#8da0b8",
                  border: `1px solid ${statusFilter === f ? "#c4824a" : "rgba(100,140,180,0.12)"}`,
                }}
              >
                {f === "semua" ? "Semua" : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

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
                    style={{ backgroundColor: "#c4824a", color: "#fff" }}
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
                        ? "rgba(180,120,30,0.05)"
                        : c.status === "diblokir"
                          ? "rgba(140,46,46,0.05)"
                          : undefined,
                    borderLeft:
                      c.status === "karantina"
                        ? "2px solid rgba(212,160,64,0.45)"
                        : c.status === "diblokir"
                          ? "2px solid rgba(224,82,82,0.45)"
                          : "2px solid transparent",
                  }}
                >
                  <td className="px-3 py-2 font-medium text-foreground">
                    <Truncate maxWidth="260px">{c.company}</Truncate>
                  </td>
                  <td className="px-3 py-2">
                    <Mono className="text-muted-foreground">{c.email}</Mono>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{CONSENT_LABELS[c.consent]}</td>
                  <td className="px-3 py-2">
                    {/*
                      Peringatan dipicu asal alamat, bukan sumber izin. Alamat hasil
                      tebakan adalah penyebab utama pemantulan keras — itulah yang
                      membuat kontak dikarantina (04-aturan-kepatuhan.md §4).
                    */}
                    <span className="inline-flex items-center gap-1.5">
                      <StatusBadge status={c.status} />
                      {c.emailOrigin === "guessed" && (
                        <span className="inline-flex" title={QUARANTINE_REASON}>
                          <AlertTriangle size={11} style={{ color: "#d4a040", flexShrink: 0 }} />
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Num className="text-muted-foreground">{c.date}</Num>
                  </td>
                  <td className="px-3 py-2">
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
        <p className="mt-2 text-xs" style={{ color: "#d4a040" }}>
          Gagal menyegarkan: {error}. Yang tampil di atas adalah data terakhir yang berhasil dimuat.
        </p>
      )}
    </div>
  );
}
