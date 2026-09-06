# 11 — Integrasi Gmail

Menyambungkan kotak masuk tim, dengan alur izin yang sama bentuknya seperti
"masuk dengan GitHub" di Netlify: pengguna diarahkan ke halaman milik Google,
memilih akun, menyetujui apa yang diminta, lalu kembali. Kata sandi Gmail tidak
pernah melewati sistem ini.

## Kenapa

Dua hal yang keduanya sudah menjadi celah nyata sebelum ini ada.

**Balasan hampir selalu luput tercatat.** Balasan kampanye mendarat di kotak
masuk biasa tim penjualan, bukan di alamat yang terpasang receipt rule SES.
Itu sebabnya `POST /campaigns/:id/balasan` manual ada sejak awal — dan jalur
manual adalah jalur yang paling jarang dipakai. Akibatnya sinyal ketertarikan
paling kuat yang dimiliki produk ini justru yang paling sering hilang, dan
kampanye tindak lanjut berpemicu `membalas` tidak pernah menjaring siapa pun.

**Dasar izin terkuat selama ini tidak terpakai.** Alamat yang pernah berbalas
surat dengan tim adalah dasar izin yang jauh di atas alamat hasil pengumpulan
otomatis, dan dapat dipertanggungjawabkan bila ditanya. Sebelum ini, satu-satunya
jalan memasukkannya adalah mengetik ulang satu per satu.

## Aturan yang ditegakkan

### Hanya korespondensi dua arah yang menjadi kontak

Alamat masuk **hanya** bila ada pesan dari mereka DAN ada pesan kepada mereka.
Satu arah — berapa pun banyaknya — tidak menjadi dasar izin.

Ini aturan kepatuhan, bukan penyaring kenyamanan. Kotak masuk mana pun penuh
alamat yang tidak pernah berinteraksi: langganan buletin, notifikasi sistem,
pendaftaran layanan. Mengirimi mereka kampanye adalah persis definisi email
tanpa dasar izin, dan tidak ada satu pun di antaranya yang pernah membalas —
karena itu "dua arah" yang menyaringnya, bukan daftar kata kunci yang harus
terus dikejar.

Penolakan lain, dan alasannya:

| Ditolak | Alasan |
|---|---|
| Rekan satu domain | Bukan prospek. Tanpa ini, kampanye perkenalan pertama mendarat di meja sebelah |
| Kiriman massal | `List-Unsubscribe`, `Precedence: bulk`, atau `Auto-Submitted` ada. Buletin yang kebetulan pernah dibalas tetap buletin |
| Alamat mesin | `no-reply@`, `mailer-daemon@`, `notifications@`, dan sejenisnya |

Kontak yang masuk diberi `consent_source = korespondensi_dua_arah` dengan
kekuatan `kuat`. Nilai itu **tidak dapat dipilih** pada impor berkas — hanya
jalur Gmail yang boleh menetapkannya, karena hanya jalur itu yang dapat
membuktikannya.

Alamat yang sudah ada di daftar penekanan tidak pernah masuk kembali.
Penyaringnya berada di dalam SQL penyisipan yang sama, bukan sebagai langkah
terpisah yang bisa terlewat.

### Isi pesan tidak pernah dibaca

Yang diminta dari Gmail hanyalah header tertentu, lewat `format=metadata`:
`From`, `To`, `Cc`, `Subject`, `Message-ID`, `In-Reply-To`, `References`,
`List-Unsubscribe`, `Precedence`, `Auto-Submitted`.

Isi pesan tidak pernah diminta, jadi ia tidak pernah melewati proses ini —
bukan sekadar tidak disimpan. Menyimpan isi korespondensi akan mengubah produk
pemasaran menjadi arsip surat pihak ketiga yang tidak pernah diminta siapa pun
untuk dibuat, dan menjadikan satu kebocoran basis data jauh lebih berat
akibatnya daripada bocornya daftar kontak.

### Token disimpan terenkripsi

Token penyegar dienkripsi AES-256-GCM dengan kunci yang diturunkan dari
`TOKEN_SECRET` (`lib/rahasia.ts`). Basis data yang bocor tanpa kunci itu tidak
menyerahkan akses ke satu kotak masuk pun.

GCM, bukan CBC: yang dikirim ke Google harus dipastikan persis yang dulu
ditulis, dan ciphertext yang diubah satu bit pun harus gagal dibuka alih-alih
membuka menjadi sampah.

## Menyiapkan kredensial Google

1. **Google Cloud Console** → buat proyek → **APIs & Services** → **Enable APIs**
   → aktifkan **Gmail API**.
2. **OAuth consent screen** → tipe **External** → isi nama aplikasi, email
   dukungan, dan domain.
3. Tambahkan scope: `.../auth/gmail.readonly`, `.../auth/userinfo.email`, `openid`.
4. **Test users** → tambahkan alamat Anda dan alamat pelanggan pertama.
5. **Credentials** → **Create credentials** → **OAuth client ID** → tipe **Web
   application**. Isi **Authorized redirect URI** persis sama dengan
   `GOOGLE_REDIRECT_URI` di `.env`.
6. Salin Client ID dan Client Secret ke `.env`, dan isi `TOKEN_SECRET`:

```bash
openssl rand -hex 32
```

### Kenapa `gmail.readonly`, bukan `gmail.metadata` yang lebih sempit

Bukan karena kita butuh isi pesan — analisis tidak pernah menyentuhnya —
melainkan karena `gmail.metadata` **tidak mengizinkan parameter pencarian `q`**
pada `users.messages.list`. Tanpa pencarian, satu-satunya cara menemukan pesan
baru adalah menelusuri seluruh kotak masuk halaman demi halaman, dan kuota
Gmail API akan habis jauh sebelum kotak masuk besar selesai dibaca.

Keduanya sama-sama scope **restricted** di mata Google, jadi memilih yang lebih
sempit pun tidak menghindarkan proses verifikasi.

## Batas status "Testing" — yang paling penting diketahui

Selama aplikasi berstatus **Testing** di Google Cloud:

| | |
|---|---|
| Pengguna | Maksimal 100 alamat yang terdaftar sebagai test user |
| **Token penyegar** | **Kedaluwarsa setelah 7 hari** |
| Verifikasi | Tidak perlu |
| Tampilan | Pengguna melihat layar "aplikasi belum diverifikasi" |

Butir kedua adalah yang menentukan: **setiap kotak masuk harus disambungkan
ulang tiap tujuh hari.** Untuk membuktikan fiturnya, itu dapat diterima. Untuk
pelanggan berbayar, tidak.

Sistem menanganinya sejujur mungkin, bukan menyembunyikannya: koneksi yang
tokennya ditolak Google (`invalid_grant`) berubah status menjadi
`perlu_sambung_ulang`, tokennya dibuang, dan layar Impor menampilkan sejak
kapan balasan berhenti tercatat beserta tombol menyambungkan ulang. Yang tidak
boleh terjadi adalah integrasi yang tampak menyala tapi diam-diam berhenti
bekerja.

### Jalan keluar untuk produksi

Dua pilihan, dan yang kedua lebih cocok dengan model penjualan Anda:

1. **Verifikasi penuh + CASA.** Menghilangkan batas 100 pengguna dan
   kedaluwarsa 7 hari. Butuh kebijakan privasi publik, video demo alur,
   justifikasi tiap scope, dan asesmen keamanan pihak ketiga yang berbiaya
   tahunan.
2. **Domain-wide delegation.** Admin Google Workspace pelanggan memberi izin
   sekali untuk seluruh domainnya. Tidak ada layar izin per pengguna, tidak ada
   kedaluwarsa 7 hari, dan **tidak perlu CASA**. Batasnya: hanya untuk
   pelanggan yang memakai Google Workspace — Gmail pribadi tidak bisa.

Untuk penjualan B2B ke perusahaan Indonesia, nomor 2 layak dijadikan jalur
utama dan nomor 1 hanya bila benar-benar ada pelanggan yang memakai Gmail
pribadi.

## Keamanan alur izin

`state` ditandatangani HMAC berisi tenant, pengguna, dan waktu kedaluwarsa,
lalu **dicocokkan dengan sesi yang sedang berjalan** di callback.

Tanpa pemeriksaan itu, seseorang dapat memancing korban membuka URL callback
berisi kode milik akun Google **penyerang** — dan kotak masuk penyerang lalu
tersambung ke pelanggan korban, yang kemudian mengimpor "kontak" pilihan
penyerang. Karena itu callback tidak dibuat publik: Google mengembalikan
pengguna lewat navigasi biasa di perambannya sendiri, sehingga cookie sesi ikut
terkirim dan `state` menjadi penjaga kedua, bukan satu-satunya.

## Rute

| Metode | Jalur | Fungsi |
|---|---|---|
| `GET` | `/integrasi/gmail` | Daftar kotak masuk tersambung |
| `POST` | `/integrasi/gmail/mulai` | Balas URL halaman izin Google |
| `GET` | `/integrasi/gmail/callback` | Tukar kode menjadi token (butuh sesi) |
| `POST` | `/integrasi/gmail/:id/sinkron` | Baca sekarang, tanpa menunggu jadwal |
| `POST` | `/integrasi/gmail/:id/putus` | Cabut akses dari sisi kita |

Pekerjaan terjadwal `gmail-sync` berjalan tiap 10 menit per pelanggan.

Memutus koneksi **tidak menghapus barisnya** — tokennya dibuang dan statusnya
menjadi `dicabut`. Siapa pernah menyambungkan kotak masuk apa, dan kapan,
adalah jejak yang tetap perlu ada setelah koneksinya berakhir; terutama karena
yang disambungkan adalah kotak masuk berisi surat pihak ketiga.

Mencabut akses dari sisi kita tidak mencabutnya dari akun Google pengguna. Itu
dilakukan sendiri di [myaccount.google.com/permissions](https://myaccount.google.com/permissions),
dan pesan setelah memutus menyebutkannya.

## Yang perlu diputuskan sebelum dijual

- **Perjanjian pemrosesan data.** Membaca kotak masuk berarti sistem memproses
  data pribadi pihak ketiga — orang yang tidak pernah berhubungan dengan
  Marketing Blast. Ini pantas disebut eksplisit dalam DPA, bukan tersirat.
- **Retensi.** Saat ini kandidat yang ditolak tidak disimpan sama sekali, dan
  itu keputusan yang benar. Kalau nanti muncul permintaan "kenapa alamat X
  tidak masuk", jawabannya harus tetap dihitung ulang dari kotak masuk — bukan
  dengan menyimpan daftar alamat yang ditolak.
- **Kotak masuk pribadi vs bersama.** Sistem tidak membedakan keduanya. Tim
  yang menyambungkan kotak masuk pribadi seseorang perlu menyadari bahwa
  korespondensi pribadinya ikut dinilai — meski hanya alamatnya yang tersimpan.
