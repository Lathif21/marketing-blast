// Tindak lanjut kampanye.
//
// Layar ini menjawab pertanyaan yang muncul setelah kampanye perkenalan
// terkirim: siapa yang layak ditindaklanjuti, dan siapa yang sudah boleh
// dihiraukan.
//
// Dua bagiannya sengaja berdampingan, bukan di layar terpisah. Keduanya adalah
// dua sisi dari keputusan yang sama, dan menaruh "yang tertarik" di satu
// tempat lalu "yang diam" di tempat lain membuat pengguna hanya melihat sisi
// yang menyenangkan. Angka penolakan yang selalu terlihat adalah bagian dari
// alasan produk ini ada.
//
// Yang tidak ditawarkan layar ini, dan tidak boleh ditambahkan: membalas isi
// balasan penerima secara otomatis. Yang dikirim adalah pesan langkah
// berikutnya yang sudah ditulis dan ditinjau lebih dulu, lewat jalur kampanye
// yang sama — lengkap dengan pemeriksaan pra-kirim dan batas pemanasan.

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Loader2,
  MailPlus,
  Pause,
  Play,
  Reply,
  Trash2,
} from "lucide-react";
import { EmptyRow, ErrorRow, LoadingRow } from "../components/AsyncState";
import { SectionTitle } from "../components/SectionTitle";
import { Th } from "../components/Th";
import { Mono, Num, PanelLabel, Truncate } from "../components/Typography";
import {
  ApiError,
  catatBalasan,
  createFollowUp,
  getTindakLanjut,
  hapusKontakDiam,
  listCampaigns,
  listKontakDiam,
  ubahPendaftaran,
  type Pemicu,
} from "../lib/api";
import { useAsync } from "../lib/useAsync";

const DEFAULT_SUBJECT = "Lanjutan: detail untuk {{nama_perusahaan}}";
const DEFAULT_BODY = [
  "Terima kasih atas tanggapan Bapak/Ibu di {{nama_perusahaan}}.",
  "",
  "Berikut rincian yang kami sebutkan sebelumnya, beserta contoh penerapannya",
  "pada perusahaan sejenis.",
  "",
  "Bila ada yang ingin didalami, cukup balas email ini.",
].join("\n");

/** Pilihan jeda. Bukan input bebas: yang dibutuhkan hanya beberapa nilai. */
const PILIHAN_JEDA = [
  { jam: 1, label: "1 jam" },
  { jam: 24, label: "1 hari" },
  { jam: 72, label: "3 hari" },
  { jam: 168, label: "1 minggu" },
];

const pesanGalat = (err: unknown) =>
  err instanceof ApiError ? err.message : ((err as Error)?.message ?? "Galat tidak dikenal");

function Kartu({
  label,
  nilai,
  keterangan,
  warna = "var(--foreground)",
}: {
  label: string;
  nilai: number;
  keterangan: string;
  warna?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-sm p-3">
      <PanelLabel>{label}</PanelLabel>
      <div className="mt-1">
        <Num className="text-lg" style={{ color: warna }}>
          {nilai.toLocaleString("id-ID")}
        </Num>
      </div>
      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{keterangan}</p>
    </div>
  );
}

export function FollowUpScreen() {
  const [campaignId, setCampaignId] = useState<string | null>(null);

  const daftar = useAsync(() => listCampaigns(1, 50), []);

  // Hanya kampanye induk yang dapat ditindaklanjuti. Rantai tindak lanjut
  // bertingkat ditolak server, jadi menawarkannya di sini hanya menjanjikan
  // sesuatu yang akan gagal saat dikirim.
  const induk = useMemo(
    () => (daftar.data?.items ?? []).filter((c) => !c.parent_campaign_id),
    [daftar.data],
  );

  const terpilih = campaignId ?? induk[0]?.id ?? null;

  const detail = useAsync(
    () => (terpilih ? getTindakLanjut(terpilih) : Promise.resolve(null)),
    [terpilih],
  );

  return (
    <div className="p-6 space-y-5">
      <div>
        <SectionTitle label="Tindak Lanjut" />
        <p className="text-sm text-muted-foreground max-w-3xl">
          Kampanye pertama hanya mengajak berkenalan. Yang bereaksi ditindaklanjuti otomatis
          lewat kampanye lanjutan; yang tidak bereaksi berhenti dikirimi dengan sendirinya —
          mereka tidak memenuhi pemicu mana pun.
        </p>
      </div>

      {/* Pemilih kampanye induk */}
      <div className="bg-card border border-border rounded-sm p-3">
        <PanelLabel sub="Reaksi dinilai per kampanye, bukan per kontak">
          Kampanye perkenalan
        </PanelLabel>
        <div className="mt-2">
          {daftar.status === "gagal" && induk.length === 0 ? (
            <ErrorRow message={daftar.error} onRetry={daftar.reload} />
          ) : daftar.status === "memuat" && induk.length === 0 ? (
            <LoadingRow />
          ) : induk.length === 0 ? (
            <EmptyRow
              title="Belum ada kampanye"
              hint="Tindak lanjut disusun dari reaksi atas kampanye yang sudah terkirim. Buat dan kirim kampanye perkenalan lebih dulu."
            />
          ) : (
            <select
              value={terpilih ?? ""}
              onChange={(e) => setCampaignId(e.target.value)}
              className="w-full bg-input-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground"
            >
              {induk.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.status}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {detail.status === "gagal" && !detail.data ? (
        <ErrorRow message={detail.error} onRetry={detail.reload} />
      ) : detail.data ? (
        <PanelKampanye data={detail.data} onBerubah={detail.reload} />
      ) : terpilih ? (
        <LoadingRow />
      ) : null}

      <PanelRetensi />
    </div>
  );
}

// ── Satu kampanye: komposisi reaksi, tindak lanjut, balasan manual ───────────

function PanelKampanye({
  data,
  onBerubah,
}: {
  data: NonNullable<Awaited<ReturnType<typeof getTindakLanjut>>>;
  onBerubah: () => void;
}) {
  const r = data.ringkasan;
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  async function jalankan(aksi: () => Promise<unknown>) {
    setSibuk(true);
    setGalat(null);
    try {
      await aksi();
      onBerubah();
    } catch (err) {
      setGalat(pesanGalat(err));
    } finally {
      setSibuk(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kartu
          label="Terkirim"
          nilai={r.terkirim}
          keterangan="Pesan perkenalan yang benar-benar keluar"
        />
        <Kartu
          label="Bereaksi"
          nilai={r.bereaksi}
          warna="var(--keterlibatan)"
          keterangan="Membuka, mengklik, atau membalas — layak ditindaklanjuti"
        />
        <Kartu
          label="Membalas"
          nilai={r.membalas}
          warna="var(--keterlibatan)"
          keterangan="Sinyal terkuat: membuka bisa tidak sengaja, membalas tidak"
        />
        <Kartu
          label="Menunggu"
          nilai={r.menunggu}
          warna="var(--peringatan)"
          keterangan={`Belum bereaksi, belum ${data.jendela_diam_hari} hari — masih bisa berubah`}
        />
        <Kartu
          label="Tanpa respons"
          nilai={r.diam}
          warna="var(--muted-foreground)"
          keterangan={`Lewat ${data.jendela_diam_hari} hari tanpa reaksi. Berhenti dikirimi dengan sendirinya`}
        />
      </div>

      {r.menolak > 0 && (
        <div className="bg-card border border-border rounded-sm p-3 flex items-start gap-2">
          <AlertTriangle size={13} style={{ color: "var(--bahaya)", flexShrink: 0, marginTop: 1 }} />
          <p className="text-xs text-muted-foreground leading-relaxed">
            <Num style={{ color: "var(--bahaya)" }}>{r.menolak}</Num> penerima menolak — keluhan spam
            atau berhenti berlangganan. Mereka tidak pernah masuk kampanye lanjutan, termasuk bila
            sebelumnya sempat membuka email. Penolakan mengalahkan reaksi, dan itu tidak dapat
            dinonaktifkan.
          </p>
        </div>
      )}

      {r.terkirim > 0 && r.dibuka === 0 && (
        <div className="bg-card border border-border rounded-sm p-3 flex items-start gap-2">
          <AlertTriangle size={13} style={{ color: "var(--peringatan)", flexShrink: 0, marginTop: 1 }} />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Belum ada satu pun pembukaan tercatat. Pembukaan hanya terdeteksi kalau klien email
            penerima memuat gambar pelacak, dan sebagian besar klien perusahaan memblokirnya —
            jadi angka nol di sini belum tentu berarti tidak ada yang membaca. Untuk kampanye
            seperti itu, pemicu <Mono>membalas</Mono> lebih dapat dipercaya daripada{" "}
            <Mono>dibuka</Mono>.
          </p>
        </div>
      )}

      <DaftarLanjutan
        data={data}
        sibuk={sibuk}
        onToggle={(id, aktif) => jalankan(() => ubahPendaftaran(id, aktif))}
      />

      <div className="grid lg:grid-cols-2 gap-5">
        <FormLanjutan campaignId={data.campaign.id} onSelesai={onBerubah} />
        <FormBalasan campaignId={data.campaign.id} onSelesai={onBerubah} />
      </div>

      {galat && (
        <p className="text-xs" style={{ color: "var(--bahaya)" }}>
          {galat}
        </p>
      )}
    </div>
  );
}

function DaftarLanjutan({
  data,
  sibuk,
  onToggle,
}: {
  data: NonNullable<Awaited<ReturnType<typeof getTindakLanjut>>>;
  sibuk: boolean;
  onToggle: (id: string, aktif: boolean) => void;
}) {
  const label = (p: Pemicu | null) =>
    data.pemicu_tersedia.find((x) => x.nilai === p)?.label ?? p ?? "—";

  return (
    <div className="bg-card border border-border rounded-sm overflow-hidden">
      <div className="px-3 py-2 border-b border-border">
        <PanelLabel sub="Penerima ditentukan pemicu, bukan daftar yang dipilih di muka">
          Kampanye lanjutan
        </PanelLabel>
      </div>
      {data.lanjutan.length === 0 ? (
        <EmptyRow
          title="Belum ada kampanye lanjutan"
          hint="Susun satu di bawah. Selama pendaftarannya aktif, siapa pun yang bereaksi nanti ikut terjaring tanpa perlu disusun ulang."
        />
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <Th>Nama</Th>
              <Th>Pemicu</Th>
              <Th>Jeda</Th>
              <Th>Status</Th>
              <Th>Pendaftaran</Th>
            </tr>
          </thead>
          <tbody>
            {data.lanjutan.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2.5">
                  <Truncate maxWidth="240px" className="text-foreground">
                    {c.name}
                  </Truncate>
                  <Truncate maxWidth="240px" className="text-muted-foreground">
                    {c.subject}
                  </Truncate>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{label(c.pemicu)}</td>
                <td className="px-3 py-2.5">
                  <Num className="text-muted-foreground">{c.jeda_lanjutan_jam} jam</Num>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{c.status}</td>
                <td className="px-3 py-2.5">
                  <button
                    disabled={sibuk}
                    onClick={() => onToggle(c.id, !c.lanjutan_aktif)}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border border-border transition-colors disabled:opacity-50"
                    style={{ color: c.lanjutan_aktif ? "var(--sukses)" : "var(--muted-foreground)" }}
                    title={
                      c.lanjutan_aktif
                        ? "Hentikan pendaftaran penerima baru. Yang sudah antre tetap dikirimi."
                        : "Lanjutkan menjaring penerima yang bereaksi."
                    }
                  >
                    {c.lanjutan_aktif ? <Play size={11} /> : <Pause size={11} />}
                    {c.lanjutan_aktif ? "Bergulir" : "Berhenti"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FormLanjutan({
  campaignId,
  onSelesai,
}: {
  campaignId: string;
  onSelesai: () => void;
}) {
  const [nama, setNama] = useState("Tindak lanjut");
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [pemicu, setPemicu] = useState<Pemicu>("membalas");
  const [jeda, setJeda] = useState(24);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [selesai, setSelesai] = useState(false);

  async function simpan() {
    setSibuk(true);
    setGalat(null);
    try {
      await createFollowUp(campaignId, {
        name: nama.trim() || "Tindak lanjut",
        subject,
        body_text: body,
        pemicu,
        jeda_lanjutan_jam: jeda,
      });
      setSelesai(true);
      onSelesai();
    } catch (err) {
      setGalat(pesanGalat(err));
    } finally {
      setSibuk(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-sm p-3 space-y-3">
      <PanelLabel sub="Dikirim otomatis kepada siapa pun yang memenuhi pemicu">
        Susun kampanye lanjutan
      </PanelLabel>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-muted-foreground">Pemicu</span>
          <select
            value={pemicu}
            onChange={(e) => setPemicu(e.target.value as Pemicu)}
            className="mt-1 w-full bg-input-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground"
          >
            <option value="membalas">Membalas email</option>
            <option value="diklik">Mengklik tautan</option>
            <option value="dibuka">Membuka email</option>
            <option value="apa_saja">Bereaksi dengan cara apa pun</option>
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-muted-foreground">Jeda setelah reaksi</span>
          <select
            value={jeda}
            onChange={(e) => setJeda(Number(e.target.value))}
            className="mt-1 w-full bg-input-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground"
          >
            {PILIHAN_JEDA.map((p) => (
              <option key={p.jam} value={p.jam}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Jeda menahan pesan agar tidak keluar dalam hitungan detik setelah seseorang membalas.
        Balasan yang langsung dijawab mesin terbaca sebagai robot, dan itu justru memicu keluhan.
      </p>

      <label className="block">
        <span className="text-xs text-muted-foreground">Nama kampanye</span>
        <input
          value={nama}
          onChange={(e) => setNama(e.target.value)}
          className="mt-1 w-full bg-input-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground"
        />
      </label>

      <label className="block">
        <span className="text-xs text-muted-foreground">Subjek</span>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="mt-1 w-full bg-input-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground"
        />
      </label>

      <label className="block">
        <span className="text-xs text-muted-foreground">Isi pesan</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={7}
          className="mt-1 w-full bg-input-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground"
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
        />
      </label>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Identitas pengirim dan tautan berhenti berlangganan tetap disisipkan server, sama seperti
        kampanye biasa. Pengirimannya juga tetap tunduk pada batas harian pemanasan.
      </p>

      <button
        onClick={simpan}
        disabled={sibuk}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-sm text-xs transition-colors disabled:opacity-50"
        style={{ backgroundColor: "rgb(var(--primary-rgb) / 0.15)", color: "var(--primary)" }}
      >
        {sibuk ? <Loader2 size={12} className="animate-spin" /> : <MailPlus size={12} />}
        Buat kampanye lanjutan
      </button>

      {selesai && !galat && (
        <p className="text-xs flex items-center gap-1.5" style={{ color: "var(--sukses)" }}>
          <CheckCircle size={11} /> Tersimpan. Penerima terdaftar sendiri saat pemicunya terpenuhi.
        </p>
      )}
      {galat && (
        <p className="text-xs" style={{ color: "var(--bahaya)" }}>
          {galat}
        </p>
      )}
    </div>
  );
}

function FormBalasan({ campaignId, onSelesai }: { campaignId: string; onSelesai: () => void }) {
  const [email, setEmail] = useState("");
  const [cuplikan, setCuplikan] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);

  async function simpan() {
    setSibuk(true);
    setGalat(null);
    setPesan(null);
    try {
      await catatBalasan(campaignId, email.trim(), cuplikan.trim() || undefined);
      setPesan(`Balasan dari ${email.trim()} tercatat.`);
      setEmail("");
      setCuplikan("");
      onSelesai();
    } catch (err) {
      setGalat(pesanGalat(err));
    } finally {
      setSibuk(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-sm p-3 space-y-3">
      <PanelLabel sub="Untuk balasan yang mendarat di kotak masuk tim, bukan di alamat sistem">
        Catat balasan manual
      </PanelLabel>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Balasan adalah sinyal ketertarikan terkuat, dan yang paling sering luput tercatat karena
        mendarat di kotak masuk biasa. Mencatatnya di sini membuat orangnya masuk kampanye
        lanjutan berpemicu <Mono>membalas</Mono> — tanpa perlu dibalas satu per satu.
      </p>

      <label className="block">
        <span className="text-xs text-muted-foreground">Alamat pembalas</span>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="orang@perusahaan.co.id"
          className="mt-1 w-full bg-input-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground font-mono"
        />
      </label>

      <label className="block">
        <span className="text-xs text-muted-foreground">Cuplikan (opsional)</span>
        <input
          value={cuplikan}
          onChange={(e) => setCuplikan(e.target.value)}
          placeholder="Minta dikirimi profil perusahaan"
          className="mt-1 w-full bg-input-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground"
        />
      </label>

      <button
        onClick={simpan}
        disabled={sibuk || !email.trim()}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-sm text-xs border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      >
        {sibuk ? <Loader2 size={12} className="animate-spin" /> : <Reply size={12} />}
        Tandai membalas
      </button>

      {pesan && (
        <p className="text-xs flex items-center gap-1.5" style={{ color: "var(--sukses)" }}>
          <CheckCircle size={11} /> {pesan}
        </p>
      )}
      {galat && (
        <p className="text-xs" style={{ color: "var(--bahaya)" }}>
          {galat}
        </p>
      )}
    </div>
  );
}

// ── Kontak tanpa respons ─────────────────────────────────────────────────────

function PanelRetensi() {
  const { status, data, error, reload } = useAsync(() => listKontakDiam(1, 100), []);
  const items = data?.items ?? [];

  const [terpilih, setTerpilih] = useState<Set<string>>(new Set());
  const [oleh, setOleh] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);

  const toggle = (id: string) =>
    setTerpilih((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function hapus() {
    setSibuk(true);
    setGalat(null);
    setPesan(null);
    try {
      const hasil = await hapusKontakDiam([...terpilih], oleh.trim());
      setPesan(
        `${hasil.dihapus} kontak dihapus` +
          (hasil.dilewati > 0
            ? `, ${hasil.dilewati} dilewati karena sudah tidak berstatus tanpa respons`
            : ""),
      );
      setTerpilih(new Set());
      reload();
    } catch (err) {
      setGalat(pesanGalat(err));
    } finally {
      setSibuk(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-sm overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-start justify-between gap-3">
        <PanelLabel
          sub={
            data
              ? `${data.total.toLocaleString("id-ID")} kontak tanpa reaksi lebih dari ${data.jendela_diam_hari} hari`
              : undefined
          }
        >
          Kontak tanpa respons
        </PanelLabel>
        <Clock size={13} className="text-muted-foreground flex-shrink-0 mt-0.5" />
      </div>

      <div className="px-3 py-2 border-b border-border">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Mereka sudah berhenti menerima kampanye lanjutan dengan sendirinya — tidak ada pemicu
          yang mereka penuhi. Penghapusan di bawah bersifat permanen dan tidak otomatis:
          pembukaan email hanya terdeteksi kalau klien penerima memuat gambar pelacak, jadi daftar
          ini juga memuat orang yang membaca setiap kata tanpa pernah terhitung membaca. Nomor
          telepon mereka tetap dapat dihubungi manusia.
        </p>
      </div>

      {status === "gagal" && items.length === 0 ? (
        <ErrorRow message={error} onRetry={reload} />
      ) : status === "memuat" && items.length === 0 ? (
        <LoadingRow />
      ) : items.length === 0 ? (
        <EmptyRow
          title="Tidak ada kontak tanpa respons"
          hint="Daftar ini terisi sendiri setelah kampanye berjalan cukup lama tanpa reaksi dari sebagian penerima."
        />
      ) : (
        <>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <Th />
                <Th>Email</Th>
                <Th>Perusahaan</Th>
                <Th align="right">Hari tanpa respons</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((k) => (
                <tr key={k.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={terpilih.has(k.id)}
                      onChange={() => toggle(k.id)}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <Mono className="text-muted-foreground">{k.email}</Mono>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <Truncate maxWidth="240px">{k.company_name ?? "—"}</Truncate>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Num className="text-muted-foreground">{k.hari_diam}</Num>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="px-3 py-2 border-t border-border flex flex-wrap items-center gap-2">
            <Num className="text-xs text-muted-foreground">{terpilih.size} dipilih</Num>
            <input
              value={oleh}
              onChange={(e) => setOleh(e.target.value)}
              placeholder="Dihapus atas nama siapa"
              className="flex-1 min-w-48 bg-input-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground"
            />
            <button
              onClick={hapus}
              disabled={sibuk || terpilih.size === 0 || !oleh.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs transition-colors disabled:opacity-40"
              style={{ backgroundColor: "rgb(var(--bahaya-rgb) / 0.15)", color: "var(--bahaya)" }}
              title={
                oleh.trim()
                  ? "Menghapus permanen kontak yang dipilih"
                  : "Penghapusan harus tercatat atas nama seseorang"
              }
            >
              {sibuk ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              Hapus permanen
            </button>
          </div>
        </>
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
