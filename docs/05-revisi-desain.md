# 05 — Revisi Desain

## Diagnosis

Prototype saat ini terbaca sebagai panel instrumentasi industri, bukan produk
digital marketing. Itu konsekuensi wajar dari arahan awal yang memang meminta
kesan "instrument panel" — tapi sekarang terasa terlalu jauh ke arah itu.

Penyebab utamanya satu hal yang mudah diukur: **`font-mono` dipakai 109 kali**
di seluruh antarmuka. Bukan hanya untuk angka dan alamat email, tapi juga
untuk kalimat penjelasan, label tombol, dan judul bagian. Teks prosa dalam
huruf monospace secara otomatis membaca sebagai terminal atau SCADA, apa pun
paletnya.

Yang **tidak** perlu diubah: latar gelap dan disiplin visualnya. Itu justru
yang membedakan produk ini dari layanan email marketing kebanyakan, dan sesuai
dengan pesan intinya — pengguna sedang memantau aset yang bisa mereka rusak.
Membuatnya seterang dan seceria produk SaaS umum akan menghapus pembeda itu.

Arah revisi: pertahankan disiplinnya, ganti kosakata visualnya. Dari
*instrumen pabrik* menjadi *ruang siaran* — dunia email marketing punya
artefaknya sendiri: kotak masuk, baris subjek, momen kirim, funnel.

## Revisi 1 — Disiplin monospace

Batasi monospace pada tiga hal saja:

- Angka dan metrik (`1.847`, `1,8%`, `313/500`)
- Alamat email dan domain
- Pengenal teknis (ID kampanye, nama berkas)

Semua prosa, label tombol, judul bagian, dan teks bantuan memakai Inter.

Perubahan ini sendirian menghilangkan sebagian besar kesan terminal, tanpa
menyentuh palet maupun tata letak. Kerjakan ini lebih dulu sebelum revisi
lain — dampaknya paling besar dengan usaha paling kecil.

## Revisi 2 — Elemen tanda tangan: baris subjek

Dalam email marketing, baris subjek adalah satu hal yang paling menentukan
berhasil-tidaknya kampanye. Di prototype, ia diperlakukan sebagai field form
biasa.

Jadikan ia elemen terbesar pada langkah penyusunan pesan:

```
┌──────────────────────────────────────────────────────────────┐
│  BARIS SUBJEK                                    47 / 60 ✓   │
│                                                              │
│  Efisiensi energi untuk {{nama_perusahaan}}                  │
│  ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔               │
│                                                              │
│  Tampil di kotak masuk:                                      │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ ● BEFISIEN            Efisiensi energi untuk PT Astra  │  │
│  │   09:24               Selamat siang Bapak Hendra, ka…  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

Ukuran font besar, hitungan karakter langsung dengan ambang aman, dan
pratinjau bagaimana baris itu benar-benar tampil di kotak masuk — lengkap
dengan pemenggalan teks pratinjau. Ini artefak paling khas dunia email
marketing, dan tidak ada di produk sejenis dalam bentuk sebesar ini.

## Revisi 3 — Runway pemanasan domain

Ganti progress bar generik untuk tahap pemanasan dengan meteran bertahap yang
menunjukkan perjalanan domain:

```
PEMANASAN DOMAIN                              Tahap 3 dari 5

  ██████████  ██████████  ███████░░░  ░░░░░░░░░░  ░░░░░░░░░░
     50/hr       100/hr      500/hr     2.000/hr    penuh
   selesai     selesai      hari 11
                                         ↑
                            313 dari 500 tersisa hari ini
```

Ini mengomunikasikan tiga hal sekaligus yang sekarang terpisah-pisah: posisi
saat ini, ke mana arahnya, dan berapa sisa hari ini. Sekaligus menjelaskan
secara visual mengapa kampanye besar bisa tertahan — pengguna melihat
alasannya, bukan sekadar menerima penolakan.

Ini elemen yang paling layak dijadikan penanda produk. Tidak ada layanan
email marketing umum yang menampilkan pemanasan domain sejelas ini, karena
kebanyakan menyembunyikannya.

## Revisi 4 — Warna untuk keterlibatan

Palet saat ini punya tiga peran: tembaga untuk aksi, teal untuk sehat,
merah untuk risiko. Yang belum punya warna sendiri justru metrik yang paling
sering dilihat pemasar — buka, klik, balasan.

Akibatnya angka keterlibatan tampil dalam abu-abu netral, dan terasa mati
padahal itu bagian paling menyenangkan dari produk ini.

Tambahkan satu warna sinyal untuk keterlibatan. Sarannya biru langit dingin
(sekitar `#5BA8C4`) — cukup berbeda dari teal kesehatan dan tembaga aksi,
dan membawa asosiasi transmisi ketimbang peringatan.

Aturannya tetap ketat: warna ini hanya untuk metrik keterlibatan. Merah dan
kuning tetap eksklusif untuk risiko, supaya artinya tidak mengabur.

## Revisi 5 — Satu momen gerak

Prototype tidak punya animasi sama sekali. Menambahkan gerakan di banyak
tempat akan membuatnya terasa seperti template; menambahkannya di satu tempat
yang tepat membuatnya terasa dirancang.

Tempat yang tepat adalah **momen kirim**. Saat kampanye diluncurkan, antrean
terlihat menyusut secara nyata — angka terkirim naik, sisa kuota harian
menurun, dan meteran runway bergeser.

Ini momen yang paling dinanti pengguna dan satu-satunya tempat di produk ini
di mana sesuatu benar-benar terjadi ke dunia luar. Selebihnya biarkan diam.

Hormati `prefers-reduced-motion`: tanpa animasi, angkanya tetap diperbarui,
hanya tanpa transisi.

## Revisi 6 — Perbaikan isi, bukan tampilan

Data tiruan memakai `LinkedIn` sebagai sumber izin. Ini bertentangan langsung
dengan keputusan kepatuhan yang sudah diambil, dan kalau prototype dipakai
untuk presentasi, menyiratkan produk mendukung praktik yang sudah diputuskan
tidak dipakai.

Ganti dengan `Formulir web`, `Pameran dagang`, `Referral mitra`, atau
`Alamat generik terpublikasi`.

## Yang sebaiknya tidak diubah

- **Latar gelap.** Sesuai isi produk dan menjadi pembeda.
- **Kerapatan tabel.** Pengguna memindai ratusan baris; kerapatan itu fitur.
- **Radius sudut kecil (6px).** Konsisten dan tidak mengikuti tren kartu
  mengambang berbayang tebal.
- **Status dengan warna dan teks sekaligus.** Sudah benar dan penting untuk
  keterbacaan.

## Urutan pengerjaan

| Urutan | Revisi | Usaha | Dampak |
|---|---|---|---|
| 1 | Disiplin monospace | Rendah | Tinggi |
| 2 | Perbaikan data tiruan LinkedIn | Sangat rendah | Tinggi bila dipresentasikan |
| 3 | Warna keterlibatan | Rendah | Sedang |
| 4 | Runway pemanasan | Sedang | Tinggi |
| 5 | Baris subjek sebagai elemen utama | Sedang | Tinggi |
| 6 | Momen kirim | Sedang | Sedang |

Dua yang pertama bisa dikerjakan dalam satu sesi dan sudah mengubah kesan
keseluruhan secara nyata.
