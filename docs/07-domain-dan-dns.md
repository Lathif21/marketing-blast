# 07 — Domain Pengirim & DNS

Cara menyiapkan domain pengirim beserta SPF, DKIM, dan DMARC. Ini prasyarat
Fase 0 dan memblokir seluruh pengujian pengiriman, jadi kerjakan lebih dulu.

Sampai selesai, sistem berjalan dengan nilai dummy dan `MAIL_DRIVER=dummy`.
Tidak ada satu pun email yang bisa keluar dalam keadaan itu.

## 1. Pilih subdomain pengirim

Kampanye dikirim dari subdomain khusus, tidak pernah dari domain yang dipakai
korespondensi sehari-hari.

Alasannya bukan kerapian. Reputasi pengirim melekat pada domain, dan kerusakan
menular ke seluruh email dari domain yang sama. Kalau kampanye dikirim dari
`perusahaan.co.id` lalu tingkat keluhan naik, email penawaran resmi dan balasan
ke pelanggan ikut masuk folder spam. Memisahkannya membuat kerusakan terburuk
hanya menyentuh kanal kampanye.

| | Contoh |
|---|---|
| Domain perusahaan | `contoh.id` — jangan dipakai mengirim kampanye |
| Domain pengirim | `blast.contoh.id` — subdomain khusus |
| Alamat pengirim | `blast@blast.contoh.id` |
| MAIL FROM kustom | `mail.blast.contoh.id` |

Subdomain tidak perlu dibeli terpisah. Kalau `contoh.id` sudah Anda miliki,
`blast.contoh.id` cukup dibuat sebagai record DNS di panel penyedia domain.

Nilai dummy yang sekarang terpasang di `.env.example` memakai pola ini persis,
jadi mengganti `SENDER_DOMAIN` sudah cukup untuk menggeser seluruh record yang
diharapkan sistem.

## 2. Tiga mekanisme yang harus dipasang

Ketiganya menjawab pertanyaan berbeda. Tidak ada yang bisa menggantikan yang
lain.

| | Menjawab | Bentuk |
|---|---|---|
| **SPF** | Server mana yang boleh mengirim atas nama domain ini? | TXT |
| **DKIM** | Apakah pesan ini benar dari domain itu dan tidak berubah di jalan? | 3 CNAME |
| **DMARC** | Apa yang harus dilakukan penerima kalau SPF dan DKIM gagal? | TXT |

Tanpa ketiganya, penyedia besar memperlakukan pengiriman massal sebagai
mencurigakan sejak pesan pertama — dan itu terjadi sebelum isi pesan sempat
dinilai.

### Soal keselarasan (alignment)

Bagian yang paling sering salah. DMARC tidak cuma menuntut SPF atau DKIM lolos,
tapi juga **selaras**: domain yang lolos SPF harus cocok dengan domain di header
`From:` yang dilihat penerima.

Secara bawaan, SES memakai domain miliknya sendiri sebagai MAIL FROM. SPF akan
lolos — tapi untuk domain Amazon, bukan domain Anda, sehingga tidak selaras.
DKIM tetap menyelamatkan DMARC dalam kondisi ini, namun bergantung pada satu
mekanisme saja membuat kegagalan DKIM langsung berarti kegagalan DMARC.

Karena itu MAIL FROM kustom (`mail.blast.contoh.id`) ikut dipasang: SPF jadi
selaras, dan DMARC punya dua jalan lolos alih-alih satu.

## 3. Record yang harus dipasang

Nilai di bawah memakai dummy `blast.contoh.id` dan region `ap-southeast-1`.
Ganti sesuai milik Anda. Token DKIM baru ada setelah domain didaftarkan di SES
— lihat [08-amazon-ses.md](08-amazon-ses.md) langkah 3.

```
# SPF pada domain pengirim
Tipe  : TXT
Nama  : blast.contoh.id
Nilai : v=spf1 include:amazonses.com -all

# SPF pada MAIL FROM kustom
Tipe  : TXT
Nama  : mail.blast.contoh.id
Nilai : v=spf1 include:amazonses.com ~all

# MAIL FROM kustom — ke mana pemantulan dikembalikan
Tipe     : MX
Nama     : mail.blast.contoh.id
Prioritas: 10
Nilai    : feedback-smtp.ap-southeast-1.amazonses.com

# DMARC
Tipe  : TXT
Nama  : _dmarc.blast.contoh.id
Nilai : v=DMARC1; p=none; rua=mailto:dmarc@contoh.id; adkim=r; aspf=r; pct=100

# DKIM — tiga record, token dari konsol SES
Tipe  : CNAME
Nama  : <token1>._domainkey.blast.contoh.id
Nilai : <token1>.dkim.amazonses.com
        (ulangi untuk token2 dan token3)
```

Catatan tentang `-all` versus `~all`: yang pertama berarti "tolak apa pun dari
luar daftar", yang kedua "tandai mencurigakan tapi terima". MAIL FROM memakai
`~all` karena itu yang direkomendasikan SES untuk jalur pemantulan; domain
pengirim boleh lebih tegas.

`p=none` pada DMARC berarti belum ada yang ditolak — laporan tetap dikirim
tanpa email hilang. Itu titik awal yang benar. Menaikkannya dibahas di
bagian 6.

## 4. Memasang di penyedia DNS

Langkahnya mirip di semua penyedia: buka pengelola DNS untuk `contoh.id`, lalu
tambahkan record satu per satu.

**Yang perlu diperhatikan soal nama record.** Sebagian besar panel menerima
nama relatif terhadap domain utama. Kalau domain Anda `contoh.id` dan record
yang diinginkan `blast.contoh.id`, isian namanya cukup `blast` — bukan
`blast.contoh.id`. Menuliskannya lengkap sering menghasilkan
`blast.contoh.id.contoh.id`. Panel biasanya menampilkan hasil akhirnya setelah
disimpan; periksa di situ.

**Cloudflare.** DNS → Records → Add record. Untuk record DKIM, matikan proxy
(ikon awan harus abu-abu, bukan oranye) — CNAME yang diproksikan tidak akan
mengembalikan nilai asli dan verifikasi SES gagal.

**cPanel (Niagahoster, Rumahweb, Domainesia).** Zone Editor → Manage → Add
Record.

**Route 53.** Kalau domain sudah di AWS, konsol SES menawarkan pemasangan
record DKIM otomatis ke hosted zone. Itu jalur paling sedikit salah ketiknya.

Propagasi biasanya menit-an, tapi bisa sampai beberapa jam tergantung TTL
sebelumnya. Selama itu, verifikasi SES akan berstatus pending — bukan gagal.

## 5. Memeriksa hasilnya

Record yang diharapkan disimpan di kode, bukan cuma di dokumen ini —
[`apps/api/src/domain/dns.ts`](../apps/api/src/domain/dns.ts) menurunkannya dari
`SENDER_DOMAIN`, jadi dokumen dan kenyataan tidak bisa berpisah diam-diam.

```bash
docker compose exec api npm run dns:check
```

Keluarannya menandai tiap record dengan `✓` (benar), `!` (ada tapi nilainya
beda), atau `×` (belum ada). Selama `SES_DKIM_TOKENS` masih kosong, tiga baris
DKIM memakai token contoh dan pasti `×` — itu hasil yang benar, bukan bug.

Pemeriksaan manual, kalau perlu pembanding:

```bash
dig +short TXT blast.contoh.id
dig +short TXT _dmarc.blast.contoh.id
dig +short MX  mail.blast.contoh.id
dig +short CNAME <token1>._domainkey.blast.contoh.id
```

Cara paling meyakinkan tetap mengirim satu email ke alamat pribadi di Gmail,
lalu buka **Show original**. Di situ terlihat `SPF: PASS`, `DKIM: PASS`, dan
`DMARC: PASS` beserta domain yang dipakai masing-masing. Kalau DMARC lolos tapi
SPF menunjuk domain `amazonses.com`, berarti MAIL FROM kustom belum aktif.

## 6. Menaikkan kebijakan DMARC

`p=none` bukan tujuan akhir. Ia hanya membuat laporan mengalir tanpa risiko
email hilang.

| Tahap | Kebijakan | Kapan pindah |
|---|---|---|
| 1 | `p=none` | Sejak awal |
| 2 | `p=quarantine` | Setelah 2–4 minggu laporan bersih |
| 3 | `p=reject` | Setelah beberapa minggu di quarantine tanpa keluhan |

Yang dimaksud "laporan bersih": tidak ada lagi sumber pengirim sah yang gagal
keselarasan. Naik ke `p=reject` sebelum itu berarti email sah Anda sendiri
mulai ditolak, dan gejalanya sulit ditelusuri karena penerima tidak melihat
apa pun.

Laporan agregat DMARC masuk sebagai XML ke `DMARC_REPORT_TO` dan tidak enak
dibaca langsung. Untuk volume kecil, membukanya manual masih memungkinkan;
di luar itu ada layanan pengurai laporan gratis untuk domain tunggal.

## 7. Menyalakan di kode

Setelah record terpasang dan SES memverifikasi domain, ganti nilai dummy di
`.env`:

```bash
SENDER_DOMAIN=blast.perusahaananda.id
SENDER_ADDRESS=blast@blast.perusahaananda.id
SENDER_NAME=Nama Perusahaan
SENDER_POSTAL_ADDRESS=Alamat fisik lengkap
DMARC_REPORT_TO=dmarc@perusahaananda.id
SES_DKIM_TOKENS=token1,token2,token3
```

`MAIL_DRIVER` tetap `dummy` sampai driver SES selesai ditulis di Fase 2.
Konfigurasi menolak start kalau `MAIL_DRIVER=ses` sementara kredensial atau
token DKIM belum lengkap — kegagalannya sengaja dibuat terlihat, bukan
diam-diam tidak mengirim.

## Kesalahan yang mahal

- **Mengirim dari domain perusahaan.** Kerusakannya menular ke email
  operasional dan baru terasa saat balasan ke pelanggan masuk spam.
- **Menganggap SPF saja cukup.** Tanpa DKIM, satu penerusan email (forward)
  sudah cukup membuat SPF gagal dan DMARC ikut gagal.
- **Langsung `p=reject`.** Email sah ikut ditolak sebelum sempat ketahuan.
- **CNAME DKIM diproksikan Cloudflare.** Verifikasi tidak akan pernah selesai,
  dan penyebabnya tidak muncul di pesan error SES.
- **Menghapus record lama setelah domain aktif.** SES memeriksa ulang secara
  berkala; DKIM yang hilang menonaktifkan pengiriman.
