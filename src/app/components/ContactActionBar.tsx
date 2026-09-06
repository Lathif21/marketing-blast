// Panel aksi untuk kontak terpilih.
//
// Aktivasi alamat hasil tebakan sengaja dibuat berbeda dari aktivasi biasa:
// ia butuh centang tersendiri, dan alasannya ditulis di layar. Bukan untuk
// menghalangi — pengguna berhak melakukannya — tapi supaya keputusannya
// diambil sadar, bukan terbawa karena kebetulan ikut terpilih.
//
// Aturannya sendiri ditegakkan server. Panel ini hanya membuatnya terlihat.

import { useState } from "react";
import { AlertTriangle, Check, Loader2, Undo2, X } from "lucide-react";
import { Num } from "./Typography";

export interface RingkasanPilihan {
  total: number;
  karantinaFound: number;
  karantinaTebakan: number;
  /** Terpilih tapi tidak dapat diaktifkan: sudah aktif atau diblokir. */
  tidakLayak: number;
  aktif: number;
}

export function ContactActionBar({
  pilihan,
  dinyatakanOleh,
  onDinyatakanOleh,
  onAktifkan,
  onKarantinakan,
  onBersihkan,
  sibuk,
}: {
  pilihan: RingkasanPilihan;
  dinyatakanOleh: string;
  onDinyatakanOleh: (v: string) => void;
  onAktifkan: (izinkanTebakan: boolean) => void;
  onKarantinakan: () => void;
  onBersihkan: () => void;
  sibuk: boolean;
}) {
  const [izinkanTebakan, setIzinkanTebakan] = useState(false);

  const namaTerisi = dinyatakanOleh.trim() !== "";
  const akanAktif = pilihan.karantinaFound + (izinkanTebakan ? pilihan.karantinaTebakan : 0);
  const bolehAktifkan = akanAktif > 0 && namaTerisi && !sibuk;

  return (
    <div
      className="bg-card border rounded-sm p-3 mb-3"
      style={{ borderColor: "rgb(var(--primary-rgb) / 0.35)" }}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-foreground">
            <Num className="font-semibold">{pilihan.total.toLocaleString("id-ID")}</Num> dipilih
          </span>

          <span className="text-xs text-muted-foreground">
            <Num>{pilihan.karantinaFound.toLocaleString("id-ID")}</Num> siap diaktifkan
            {pilihan.karantinaTebakan > 0 && (
              <>
                {" · "}
                <span style={{ color: "var(--peringatan)" }}>
                  <Num>{pilihan.karantinaTebakan.toLocaleString("id-ID")}</Num> alamat tebakan
                </span>
              </>
            )}
            {pilihan.tidakLayak > 0 && (
              <>
                {" · "}
                <Num>{pilihan.tidakLayak.toLocaleString("id-ID")}</Num> tidak dapat diaktifkan
              </>
            )}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <input
            type="text"
            placeholder="Dinyatakan oleh (nama Anda)"
            value={dinyatakanOleh}
            onChange={(e) => onDinyatakanOleh(e.target.value)}
            className="bg-secondary border border-border rounded-sm px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none w-56"
            style={{ caretColor: "var(--primary)" }}
          />

          {pilihan.aktif > 0 && (
            <button
              onClick={onKarantinakan}
              disabled={sibuk}
              className="px-3 py-1.5 text-xs border border-border rounded-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              title="Kembalikan kontak aktif yang terpilih ke karantina"
            >
              <Undo2 size={12} /> Karantinakan <Num>{pilihan.aktif}</Num>
            </button>
          )}

          <button
            onClick={() => onAktifkan(izinkanTebakan)}
            disabled={!bolehAktifkan}
            title={
              !namaTerisi
                ? "Isi nama penanggung jawab terlebih dahulu"
                : akanAktif === 0
                  ? "Tidak ada kontak terpilih yang dapat diaktifkan"
                  : undefined
            }
            className="px-3 py-1.5 text-xs rounded-sm flex items-center gap-1.5 transition-all"
            style={{
              backgroundColor: bolehAktifkan ? "var(--sukses-kuat)" : "rgb(var(--kabut-rgb) / 0.1)",
              color: bolehAktifkan ? "var(--primary-foreground)" : "var(--muted-foreground)",
              cursor: bolehAktifkan ? "pointer" : "not-allowed",
            }}
          >
            {sibuk ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Aktifkan <Num>{akanAktif.toLocaleString("id-ID")}</Num>
          </button>

          <button
            onClick={onBersihkan}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Batalkan pilihan"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/*
        Pengecualian §4. Muncul hanya kalau memang ada alamat tebakan terpilih
        — opsi yang selalu terlihat lama-lama berhenti dibaca.
      */}
      {pilihan.karantinaTebakan > 0 && (
        <label
          className="flex items-start gap-2 mt-3 pt-3 border-t border-border cursor-pointer"
          style={{ borderColor: "rgb(var(--peringatan-rgb) / 0.2)" }}
        >
          <input
            type="checkbox"
            checked={izinkanTebakan}
            onChange={(e) => setIzinkanTebakan(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-xs text-muted-foreground leading-relaxed">
            <span className="inline-flex items-center gap-1" style={{ color: "var(--peringatan)" }}>
              <AlertTriangle size={11} />
              Ikut aktifkan <Num>{pilihan.karantinaTebakan.toLocaleString("id-ID")}</Num> alamat
              hasil tebakan
            </span>
            <br />
            Alamat seperti <span className="font-mono">info@domain</span> disintesis dari nama
            domain dan belum tentu ada. Ini penyebab utama pemantulan keras, dan pemantulan tinggi
            merusak reputasi domain secara menular. Aktivasinya dicatat atas nama Anda.
          </span>
        </label>
      )}
    </div>
  );
}
