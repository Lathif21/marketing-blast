// Konsol superadmin: satu layar untuk seluruh pelanggan.
//
// Yang ditampilkan dipilih untuk satu keputusan: pelanggan mana yang perlu
// ditindak. Karena itu kolomnya bukan "informasi akun" melainkan angka yang
// menunjukkan kerusakan — pemantulan, keluhan, volume tujuh hari — dan
// tindakannya (bekukan, masuk sebagai, lihat data) ada di baris yang sama
// dengan angkanya.
//
// Satu aturan tampilan yang tidak boleh dilanggar di berkas ini: bounce dan
// keluhan bernilai `null` ditampilkan sebagai "—", BUKAN 0%. Nol persen
// terbaca sebagai "sangat sehat" padahal artinya "belum ada yang bisa
// diukur", dan ini justru layar yang dipakai memutuskan siapa yang dibekukan.

import { useState } from "react";
import {
  AlertTriangle,
  Eye,
  KeyRound,
  Loader2,
  LogIn,
  Pause,
  Play,
  Plus,
  ScrollText,
  Users,
} from "lucide-react";
import { EmptyRow, ErrorRow, LoadingRow } from "../components/AsyncState";
import { SectionTitle } from "../components/SectionTitle";
import { Th } from "../components/Th";
import { Mono, Num, PanelLabel, Truncate } from "../components/Typography";
import {
  ApiError,
  aktifkanTenant,
  bekukanTenant,
  createPengguna,
  createTenant,
  keluarImpersonasi,
  LABEL_AKSI,
  listAudit,
  listPengguna,
  listTenants,
  mulaiImpersonasi,
  nonaktifkanTenant,
  pratinjauTenant,
  setelSandiPengguna,
  ubahAktifPengguna,
  updateTenant,
  type RingkasanTenant,
} from "../lib/api";
import { useAsync } from "../lib/useAsync";

const pesanGalat = (err: unknown) =>
  err instanceof ApiError ? err.message : ((err as Error)?.message ?? "Galat tidak dikenal");

const WARNA_STATUS: Record<string, { color: string; bg: string }> = {
  aktif: { color: "var(--sukses)", bg: "rgb(var(--sukses-rgb) / 0.14)" },
  dibekukan: { color: "var(--peringatan)", bg: "rgb(var(--peringatan-rgb) / 0.15)" },
  nonaktif: { color: "var(--secondary-foreground)", bg: "rgb(var(--kabut-rgb) / 0.1)" },
};

/** `null` menjadi "—". Lihat catatan di atas berkas. */
function Persen({ nilai, ambang }: { nilai: number | null; ambang: number }) {
  if (nilai === null) {
    return (
      <Num className="text-muted-foreground" title="Belum ada pengiriman — belum ada yang bisa diukur">
        —
      </Num>
    );
  }
  return (
    <Num style={{ color: nilai >= ambang ? "var(--bahaya)" : "var(--secondary-foreground)" }}>{nilai}%</Num>
  );
}

export function SuperadminScreen({ onImpersonasi }: { onImpersonasi: () => void }) {
  const daftar = useAsync(() => listTenants(), []);
  const [terpilih, setTerpilih] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [formBaru, setFormBaru] = useState(false);

  const items = daftar.data?.items ?? [];
  const tenant = items.find((t) => t.id === terpilih) ?? null;

  async function jalankan(aksi: () => Promise<unknown>) {
    setSibuk(true);
    setGalat(null);
    try {
      await aksi();
      daftar.reload();
    } catch (err) {
      setGalat(pesanGalat(err));
    } finally {
      setSibuk(false);
    }
  }

  /** Masuk sebagai pelanggan: setelah ini seluruh aplikasi berpindah konteks. */
  async function masukSebagai(id: string) {
    setSibuk(true);
    setGalat(null);
    try {
      await mulaiImpersonasi(id);
      onImpersonasi();
    } catch (err) {
      setGalat(pesanGalat(err));
      setSibuk(false);
    }
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionTitle label="Kendali Pelanggan" />
          <p className="text-sm text-muted-foreground max-w-3xl">
            Angka tujuh hari terakhir per pelanggan. Pembekuan menghentikan pengiriman seketika dan
            mencabut sesi yang sedang berjalan — data pelanggan tetap utuh dan tetap dapat mereka
            lihat, beserta alasannya.
          </p>
        </div>
        <button
          onClick={() => setFormBaru((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs transition-colors flex-shrink-0"
          style={{ backgroundColor: "rgb(var(--primary-rgb) / 0.15)", color: "var(--primary)" }}
        >
          <Plus size={12} /> Pelanggan baru
        </button>
      </div>

      {formBaru && (
        <FormPelangganBaru
          onSelesai={() => {
            setFormBaru(false);
            daftar.reload();
          }}
        />
      )}

      <div className="bg-card border border-border rounded-sm overflow-hidden">
        {daftar.status === "gagal" && items.length === 0 ? (
          <ErrorRow message={daftar.error} onRetry={daftar.reload} />
        ) : daftar.status === "memuat" && items.length === 0 ? (
          <LoadingRow />
        ) : items.length === 0 ? (
          <EmptyRow
            title="Belum ada pelanggan"
            hint="Buat pelanggan pertama beserta admin-nya. Pelanggan tanpa pengguna tidak dapat dimasuki siapa pun."
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <Th>Pelanggan</Th>
                  <Th>Status</Th>
                  <Th>Domain</Th>
                  <Th align="right">Kontak</Th>
                  <Th align="right">Kampanye</Th>
                  <Th align="right">Terkirim 7h</Th>
                  <Th align="right">Bounce</Th>
                  <Th align="right">Keluhan</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {items.map((t) => {
                  const gaya = WARNA_STATUS[t.status];
                  const aktif = terpilih === t.id;
                  return (
                    <tr
                      key={t.id}
                      onClick={() => setTerpilih(aktif ? null : t.id)}
                      className="border-b border-border last:border-0 cursor-pointer"
                      style={{ backgroundColor: aktif ? "rgb(var(--primary-rgb) / 0.07)" : undefined }}
                    >
                      <td className="px-3 py-2.5">
                        <Truncate maxWidth="200px" className="text-foreground">
                          {t.nama}
                        </Truncate>
                        <Mono className="text-muted-foreground">{t.slug}</Mono>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded-sm"
                          style={{ backgroundColor: gaya.bg, color: gaya.color }}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Mono className="text-muted-foreground">{t.domain ?? "—"}</Mono>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Num className="text-muted-foreground">
                          {t.kontak.toLocaleString("id-ID")}
                          {t.kuota_kontak !== null && (
                            <span style={{ color: "var(--samar)" }}>/{t.kuota_kontak}</span>
                          )}
                        </Num>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Num className="text-muted-foreground">{t.kampanye}</Num>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Num className="text-muted-foreground">{t.terkirim_7h}</Num>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Persen nilai={t.bounce_rate_7h} ambang={5} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Persen nilai={t.complaint_rate_7h} ambang={0.1} />
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void masukSebagai(t.id);
                          }}
                          disabled={sibuk || t.status === "nonaktif"}
                          className="flex items-center gap-1.5 px-2 py-1 rounded-sm border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                          title="Buka aplikasi persis seperti yang dilihat pelanggan ini. Tercatat di jejak audit."
                        >
                          <LogIn size={11} /> Masuk
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {galat && (
        <p className="text-xs" style={{ color: "var(--bahaya)" }}>
          {galat}
        </p>
      )}

      {tenant && (
        <PanelPelanggan
          tenant={tenant}
          sibuk={sibuk}
          onBekukan={(alasan) => jalankan(() => bekukanTenant(tenant.id, alasan))}
          onAktifkan={() => jalankan(() => aktifkanTenant(tenant.id))}
          onNonaktifkan={() => jalankan(() => nonaktifkanTenant(tenant.id))}
          onKuota={(kuota) => jalankan(() => updateTenant(tenant.id, { kuota_kontak: kuota }))}
        />
      )}

      <PanelAudit />
    </div>
  );
}

// ── Pelanggan baru ───────────────────────────────────────────────────────────

function FormPelangganBaru({ onSelesai }: { onSelesai: () => void }) {
  const [nama, setNama] = useState("");
  const [slug, setSlug] = useState("");
  const [kuota, setKuota] = useState("");
  const [email, setEmail] = useState("");
  const [namaAdmin, setNamaAdmin] = useState("");
  const [sandi, setSandi] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  async function simpan() {
    setSibuk(true);
    setGalat(null);
    try {
      await createTenant({
        nama: nama.trim(),
        slug: slug.trim().toLowerCase(),
        kuota_kontak: kuota.trim() ? Number(kuota) : null,
        admin: { email: email.trim(), nama: namaAdmin.trim(), sandi },
      });
      onSelesai();
    } catch (err) {
      setGalat(pesanGalat(err));
    } finally {
      setSibuk(false);
    }
  }

  const isi = (
    label: string,
    nilai: string,
    set: (v: string) => void,
    opsi: { mono?: boolean; tipe?: string; petunjuk?: string } = {},
  ) => (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type={opsi.tipe ?? "text"}
        value={nilai}
        onChange={(e) => set(e.target.value)}
        placeholder={opsi.petunjuk}
        className={`mt-1 w-full bg-input-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground ${
          opsi.mono ? "font-mono" : ""
        }`}
      />
    </label>
  );

  return (
    <div className="bg-card border border-border rounded-sm p-3 space-y-3">
      <PanelLabel sub="Pelanggan dan admin pertamanya dibuat bersamaan — pelanggan tanpa pengguna tidak dapat dimasuki siapa pun">
        Pelanggan baru
      </PanelLabel>

      <div className="grid md:grid-cols-3 gap-3">
        {isi("Nama perusahaan", nama, setNama)}
        {isi("Slug", slug, setSlug, { mono: true, petunjuk: "pt-contoh" })}
        {isi("Kuota kontak", kuota, setKuota, { petunjuk: "kosong = tanpa batas" })}
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        {isi("Email admin", email, setEmail, { mono: true, tipe: "email" })}
        {isi("Nama admin", namaAdmin, setNamaAdmin)}
        {isi("Kata sandi awal", sandi, setSandi, { petunjuk: "minimal 12 karakter" })}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Kata sandi ini harus disampaikan ke pelanggan lewat jalur lain — sistem tidak mengirim
        email pemulihan, dan domain pengirim tidak dipakai untuk apa pun selain kampanye.
      </p>

      <button
        onClick={simpan}
        disabled={sibuk || !nama.trim() || !slug.trim() || !email.trim() || !sandi}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs transition-colors disabled:opacity-50"
        style={{ backgroundColor: "rgb(var(--primary-rgb) / 0.15)", color: "var(--primary)" }}
      >
        {sibuk ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
        Buat pelanggan
      </button>

      {galat && (
        <p className="text-xs" style={{ color: "var(--bahaya)" }}>
          {galat}
        </p>
      )}
    </div>
  );
}

// ── Satu pelanggan ───────────────────────────────────────────────────────────

function PanelPelanggan({
  tenant,
  sibuk,
  onBekukan,
  onAktifkan,
  onNonaktifkan,
  onKuota,
}: {
  tenant: RingkasanTenant;
  sibuk: boolean;
  onBekukan: (alasan: string) => void;
  onAktifkan: () => void;
  onNonaktifkan: () => void;
  onKuota: (kuota: number | null) => void;
}) {
  const [alasan, setAlasan] = useState("");
  const [kuota, setKuota] = useState(tenant.kuota_kontak?.toString() ?? "");

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <div className="bg-card border border-border rounded-sm p-3 space-y-3">
        <PanelLabel sub={tenant.slug}>{tenant.nama}</PanelLabel>

        {tenant.status === "dibekukan" && (
          <div className="flex items-start gap-2">
            <AlertTriangle size={13} style={{ color: "var(--peringatan)", flexShrink: 0, marginTop: 1 }} />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Dibekukan {tenant.dibekukan_pada?.slice(0, 10)} oleh{" "}
              <Mono>{tenant.dibekukan_oleh}</Mono>: {tenant.alasan_beku}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs">
          {[
            ["Kontak aktif", tenant.kontak_aktif.toLocaleString("id-ID")],
            ["Pengguna", String(tenant.pengguna)],
            ["Tahap pemanasan", tenant.warmup_stage ? `${tenant.warmup_stage}/5` : "—"],
            ["Daftar penekanan", tenant.penekanan.toLocaleString("id-ID")],
          ].map(([label, nilai]) => (
            <div key={label} className="flex justify-between">
              <span className="text-muted-foreground">{label}</span>
              <Num className="text-foreground">{nilai}</Num>
            </div>
          ))}
        </div>

        {tenant.status === "aktif" ? (
          <div className="space-y-2 pt-1">
            <input
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder="Alasan pembekuan — pelanggan melihatnya"
              className="w-full bg-input-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground"
            />
            <div className="flex gap-2">
              <button
                onClick={() => onBekukan(alasan.trim())}
                disabled={sibuk || !alasan.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs transition-colors disabled:opacity-40"
                style={{ backgroundColor: "rgb(var(--peringatan-rgb) / 0.15)", color: "var(--peringatan)" }}
              >
                <Pause size={11} /> Bekukan pengiriman
              </button>
              <button
                onClick={onNonaktifkan}
                disabled={sibuk}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs transition-colors disabled:opacity-40"
                style={{ backgroundColor: "rgb(var(--bahaya-rgb) / 0.15)", color: "var(--bahaya)" }}
              >
                Nonaktifkan akun
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={onAktifkan}
            disabled={sibuk}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs transition-colors disabled:opacity-40"
            style={{ backgroundColor: "rgb(var(--sukses-rgb) / 0.14)", color: "var(--sukses)" }}
          >
            <Play size={11} /> Aktifkan kembali
          </button>
        )}

        <div className="flex items-end gap-2 pt-1">
          <label className="flex-1">
            <span className="text-xs text-muted-foreground">Kuota kontak</span>
            <input
              value={kuota}
              onChange={(e) => setKuota(e.target.value)}
              placeholder="kosong = tanpa batas"
              className="mt-1 w-full bg-input-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground"
            />
          </label>
          <button
            onClick={() => onKuota(kuota.trim() ? Number(kuota) : null)}
            disabled={sibuk}
            className="px-3 py-1.5 rounded-sm text-xs border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            Simpan
          </button>
        </div>
      </div>

      <div className="space-y-5">
        <PanelPengguna tenantId={tenant.id} />
        <PanelPratinjau tenantId={tenant.id} />
      </div>
    </div>
  );
}

function PanelPengguna({ tenantId }: { tenantId: string }) {
  const { status, data, error, reload } = useAsync(() => listPengguna(tenantId), [tenantId]);
  const [tambah, setTambah] = useState(false);
  const [email, setEmail] = useState("");
  const [nama, setNama] = useState("");
  const [sandi, setSandi] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);

  async function jalankan(aksi: () => Promise<unknown>, sukses?: string) {
    setSibuk(true);
    setGalat(null);
    setPesan(null);
    try {
      await aksi();
      if (sukses) setPesan(sukses);
      reload();
    } catch (err) {
      setGalat(pesanGalat(err));
    } finally {
      setSibuk(false);
    }
  }

  const items = data?.items ?? [];

  return (
    <div className="bg-card border border-border rounded-sm overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <PanelLabel>Pengguna</PanelLabel>
        <button
          onClick={() => setTambah((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Users size={11} /> Tambah
        </button>
      </div>

      {tambah && (
        <div className="px-3 py-2 border-b border-border space-y-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
            className="w-full bg-input-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground font-mono"
          />
          <input
            value={nama}
            onChange={(e) => setNama(e.target.value)}
            placeholder="nama"
            className="w-full bg-input-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground"
          />
          <input
            value={sandi}
            onChange={(e) => setSandi(e.target.value)}
            placeholder="kata sandi awal (minimal 12 karakter)"
            className="w-full bg-input-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground"
          />
          <button
            onClick={() =>
              jalankan(
                () =>
                  createPengguna(tenantId, {
                    email: email.trim(),
                    nama: nama.trim(),
                    sandi,
                    peran: "operator",
                  }),
                "Pengguna dibuat.",
              ).then(() => {
                setEmail("");
                setNama("");
                setSandi("");
              })
            }
            disabled={sibuk || !email.trim() || !nama.trim() || !sandi}
            className="px-3 py-1.5 rounded-sm text-xs border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            Buat operator
          </button>
        </div>
      )}

      {status === "gagal" && items.length === 0 ? (
        <ErrorRow message={error} onRetry={reload} />
      ) : status === "memuat" && items.length === 0 ? (
        <LoadingRow />
      ) : items.length === 0 ? (
        <EmptyRow
          title="Belum ada pengguna"
          hint="Pelanggan ini tidak dapat dimasuki siapa pun sampai ada satu pengguna."
        />
      ) : (
        <table className="w-full text-xs">
          <tbody>
            {items.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2.5">
                  <Mono className="text-muted-foreground">{u.email}</Mono>
                  <div className="text-muted-foreground">
                    {u.nama} · {u.peran}
                    {!u.aktif && <span style={{ color: "var(--peringatan)" }}> · nonaktif</span>}
                  </div>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button
                    onClick={() => {
                      const baru = window.prompt("Kata sandi baru (minimal 12 karakter)");
                      if (baru) void jalankan(() => setelSandiPengguna(u.id, baru), "Sandi disetel.");
                    }}
                    disabled={sibuk}
                    className="px-2 py-1 mr-1 rounded-sm border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                    title="Setel ulang kata sandi"
                  >
                    <KeyRound size={11} />
                  </button>
                  <button
                    onClick={() => void jalankan(() => ubahAktifPengguna(u.id, !u.aktif))}
                    disabled={sibuk}
                    className="px-2 py-1 rounded-sm border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                  >
                    {u.aktif ? "Matikan" : "Hidupkan"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(pesan || galat) && (
        <div className="px-3 py-2 border-t border-border">
          {pesan && (
            <p className="text-xs" style={{ color: "var(--sukses)" }}>
              {pesan}
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

/**
 * Pratinjau data pelanggan, hanya baca dan hanya saat diminta.
 *
 * Tidak dimuat otomatis saat baris dipilih, dan itu bukan penghematan
 * permintaan: setiap pembukaan tercatat di jejak audit atas nama superadmin
 * yang membukanya. Memuatnya sendiri akan mengisi jejak itu dengan akses yang
 * tidak pernah benar-benar diminta siapa pun, dan jejak yang penuh derau
 * berhenti berguna sebagai jejak.
 */
function PanelPratinjau({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof pratinjauTenant>> | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  async function buka() {
    setSibuk(true);
    setGalat(null);
    try {
      setData(await pratinjauTenant(tenantId));
    } catch (err) {
      setGalat(pesanGalat(err));
    } finally {
      setSibuk(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-sm p-3 space-y-2">
      <PanelLabel sub="Setiap pembukaan tercatat di jejak audit atas nama Anda">
        Data pelanggan
      </PanelLabel>

      {!data ? (
        <button
          onClick={buka}
          disabled={sibuk}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
        >
          {sibuk ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
          Lihat 25 kontak & kampanye terakhir
        </button>
      ) : (
        <div className="space-y-2">
          <div className="max-h-48 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {data.kontak.map((k) => (
                  <tr key={k.email} className="border-b border-border last:border-0">
                    <td className="px-1 py-1">
                      <Mono className="text-muted-foreground">{k.email}</Mono>
                    </td>
                    <td className="px-1 py-1 text-muted-foreground">
                      <Truncate maxWidth="160px">{k.company_name ?? "—"}</Truncate>
                    </td>
                    <td className="px-1 py-1 text-right text-muted-foreground">{k.respons}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs" style={{ color: "var(--samar)" }}>
            {data.catatan}
          </p>
        </div>
      )}

      {galat && (
        <p className="text-xs" style={{ color: "var(--bahaya)" }}>
          {galat}
        </p>
      )}
    </div>
  );
}

// ── Jejak audit ──────────────────────────────────────────────────────────────

function PanelAudit() {
  const { status, data, error, reload } = useAsync(() => listAudit(1, 40), []);
  const items = data?.items ?? [];

  return (
    <div className="bg-card border border-border rounded-sm overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <ScrollText size={13} style={{ color: "var(--primary)" }} />
        <PanelLabel sub="Hanya bertambah — tidak dapat disunting maupun dihapus, termasuk oleh superadmin">
          Jejak tindakan
        </PanelLabel>
      </div>

      {status === "gagal" && items.length === 0 ? (
        <ErrorRow message={error} onRetry={reload} />
      ) : status === "memuat" && items.length === 0 ? (
        <LoadingRow />
      ) : items.length === 0 ? (
        <EmptyRow
          title="Belum ada tindakan tercatat"
          hint="Pembuatan pelanggan, pembekuan, impersonasi, dan pembacaan data pelanggan muncul di sini."
        />
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <Th>Waktu</Th>
              <Th>Pelaku</Th>
              <Th>Pelanggan</Th>
              <Th>Tindakan</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2.5">
                  <Num className="text-muted-foreground">
                    {new Date(a.created_at).toLocaleString("id-ID", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Num>
                </td>
                <td className="px-3 py-2.5">
                  <Mono className="text-muted-foreground">{a.actor_email}</Mono>
                </td>
                <td className="px-3 py-2.5">
                  <Mono className="text-muted-foreground">{a.tenant_slug ?? "—"}</Mono>
                </td>
                <td className="px-3 py-2 text-foreground">{LABEL_AKSI[a.aksi] ?? a.aksi}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Bilah impersonasi. Dipasang di atas seluruh aplikasi, bukan di satu layar. */
export function BilahImpersonasi({
  nama,
  onKeluar,
}: {
  nama: string;
  onKeluar: () => void;
}) {
  const [sibuk, setSibuk] = useState(false);

  return (
    <div
      className="flex items-center justify-between gap-3 px-6 py-1.5 flex-shrink-0"
      style={{ backgroundColor: "rgb(var(--peringatan-rgb) / 0.18)", borderBottom: "1px solid rgb(var(--peringatan-rgb) / 0.3)" }}
    >
      <span className="text-xs" style={{ color: "var(--peringatan)" }}>
        Anda melihat aplikasi sebagai <strong>{nama}</strong>. Setiap tindakan tercatat atas nama
        Anda, bukan atas nama pelanggan.
      </span>
      <button
        onClick={async () => {
          setSibuk(true);
          try {
            await keluarImpersonasi();
            onKeluar();
          } finally {
            setSibuk(false);
          }
        }}
        disabled={sibuk}
        className="text-xs px-2 py-0.5 rounded-sm flex-shrink-0 transition-colors disabled:opacity-50"
        style={{ backgroundColor: "rgb(var(--kabut-rgb) / 0.18)", color: "var(--peringatan)" }}
      >
        {sibuk ? "Keluar…" : "Kembali ke kendali superadmin"}
      </button>
    </div>
  );
}
