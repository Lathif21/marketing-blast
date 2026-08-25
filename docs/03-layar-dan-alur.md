# 03 — Layar & Alur

Prototype sudah memuat keenam layar. Dokumen ini menandai apa yang sudah ada,
apa yang belum, dan apa yang perlu diperbaiki.

## Ringkasan celah

| Layar | Prototype | Celah utama |
|---|---|---|
| Dashboard | Lengkap | Panel kesehatan domain masih statis |
| Impor | 3 langkah lengkap | Tidak ada penanganan `email_source`, pemetaan kurang `consent_source` |
| Daftar kontak | Lengkap | Sumber izin `LinkedIn` bertentangan dengan keputusan kepatuhan |
| Penyusun kampanye | 3 langkah lengkap | Keadaan terblokir karena batas pemanasan belum ada |
| Laporan | Lengkap | Dampak reputasi per kampanye belum ada |
| Penekanan | Lengkap | Sudah sesuai |

## 1. Dashboard

Sudah ada: panel kesehatan domain, daftar kampanye, distribusi kontak
(aktif / karantina / diblokir).

Yang perlu ditambahkan:

- Panel kesehatan mengambil data dari `/domain/health`, bukan konstanta
- Ambang peringatan: bounce di atas 5% dan keluhan di atas 0,1% mengubah
  panel ke keadaan peringatan
- Sisa kuota harian ditampilkan sebagai angka yang dapat dipakai
  langsung — "313 dari 500 tersisa hari ini", bukan sekadar persentase

## 2. Impor

Tiga langkah sudah benar: unggah → pemetaan → validasi.

**Yang hilang dan penting:**

Pemetaan saat ini hanya menyediakan email, nama perusahaan, industri, kota.
`consent_source` tidak ada padahal wajib. Tambahkan sebagai:

- Pilihan tunggal untuk seluruh berkas, atau
- Kolom yang dipetakan bila berkas sudah memuatnya

Impor tidak boleh dilanjutkan tanpa ini terisi.

**Deteksi otomatis Contact Harvester:** kalau susunan kolom cocok dengan 13
kolom alat internal, lewati langkah pemetaan sepenuhnya dan tampilkan
ringkasan pemetaan sebagai konfirmasi saja.

**Ringkasan validasi** perlu memisahkan karantina dari ditolak. Keduanya
berbeda: karantina masih bisa aktif setelah verifikasi, ditolak tidak.

```
Diterima          1.204    Siap dikirim setelah verifikasi
Karantina           118    Alamat hasil tebakan, perlu verifikasi
Duplikat             15    Sudah ada di basis data
Ditolak               5    Format tidak valid atau ada di daftar penekanan
```

## 3. Daftar kontak

**Harus diperbaiki:** data tiruan memakai `LinkedIn` sebagai sumber izin pada
tiga baris. Ini bertentangan langsung dengan keputusan kepatuhan yang sudah
diambil — sourcing LinkedIn dihapus sepenuhnya dari lingkup, baik manual
maupun otomatis.

Ganti dengan sumber yang sah: `Formulir web`, `Pameran dagang`,
`Referral mitra`, `Alamat generik terpublikasi`.

Ini bukan sekadar teks contoh. Kalau prototype dipakai untuk presentasi ke
manajemen atau calon klien, mencantumkan LinkedIn menyiratkan produk
mendukung praktik yang sudah kita putuskan tidak dipakai.

Selain itu: baris karantina perlu menampilkan alasannya saat disorot —
"alamat hasil tebakan, belum diverifikasi" — supaya pengguna paham mengapa
kontak itu tidak terkirimi.

## 4. Penyusun kampanye

Tiga langkah sudah benar. Yang belum ada adalah **keadaan terblokir** pada
langkah tinjau.

Kalau jumlah penerima melebihi sisa kuota harian:

```
┌─────────────────────────────────────────────────┐
│  Kampanye ditahan                               │
│                                                 │
│  450 penerima dipilih, sisa kuota hari ini 313. │
│  Domain masih dalam tahap pemanasan 3 dari 5.   │
│                                                 │
│  Pilihan:                                       │
│  → Kirim 313 sekarang, sisanya besok            │
│  → Jadwalkan seluruhnya pada 28 Agustus         │
│  → Kurangi jumlah penerima                      │
└─────────────────────────────────────────────────┘
```

Nadanya menjelaskan dan menawarkan jalan keluar, bukan menghukum. Pengguna
sedang dilindungi dari kerusakan yang tidak terlihat, dan itu harus terasa
seperti bantuan.

**Daftar periksa kepatuhan** pada langkah tinjau menampilkan hasil
`/campaigns/:id/preflight`:

- Identitas pengirim tercantum
- Tautan berhenti berlangganan tersisip
- Kontak penekanan sudah dikeluarkan (jumlahnya disebut)
- Kontak karantina sudah dikeluarkan (jumlahnya disebut)
- Volume dalam batas pemanasan

Butir yang gagal memblokir pengiriman, bukan sekadar memberi peringatan.

## 5. Laporan kampanye

Funnel sudah ada. Yang perlu ditambahkan: **dampak terhadap reputasi domain**
dari kampanye ini — bounce dan keluhan yang dihasilkannya, dibandingkan
ambang aman.

Ini menutup lingkaran. Pengguna melihat bahwa kampanye bukan cuma
menghasilkan angka buka dan klik, tapi juga menyisakan jejak pada aset yang
mereka pakai terus-menerus.

## 6. Daftar penekanan

Sudah sesuai: hanya baca, ada alasan dan tanggal.

Satu tambahan kecil: nyatakan di layar bahwa daftar ini permanen dan tidak
dapat dihapus, sebagai penjelasan singkat di bawah judul. Pengguna yang
mencari tombol hapus perlu tahu alasannya, bukan sekadar tidak menemukannya.
