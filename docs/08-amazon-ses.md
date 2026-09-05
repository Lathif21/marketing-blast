# 08 — Amazon SES

Cara menyiapkan akun pengiriman di Amazon SES, dari mendaftar sampai webhook
pemantulan bekerja.

Satu langkah di sini memakan waktu paling lama dan menghambat semua pengujian
pengiriman: **keluar dari sandbox**. Ajukan di Fase 0, jangan menunggu bagian
lain selesai.

> Tata letak konsol AWS dan angka kuotanya berubah dari waktu ke waktu.
> Alur di bawah stabil, tapi cocokkan detail angka dengan yang tampil di konsol
> Anda sendiri.

## Kenapa SES

SES paling murah dan tanpa biaya minimum bulanan, tapi tidak menyediakan
penyusun kampanye, manajemen kontak, maupun penanganan berhenti berlangganan.
Ketiganya justru bagian yang kita bangun sendiri dan menjadi produk.

Konsekuensinya perlu disebut jelas: **penanganan pemantulan dan keluhan adalah
pekerjaan kita, bukan bawaan.** Penyedia lain melakukannya otomatis. Di SES,
kalau webhook belum jalan, alamat mati tetap dikirimi berulang kali dan
reputasi rusak tanpa ada yang memberi tahu.

## 1. Akun AWS

Daftar di `aws.amazon.com`. Perlu kartu kredit atau debit berlogo Visa/
Mastercard; ada penagihan verifikasi kecil yang dikembalikan.

Setelah masuk, segera:

- Aktifkan MFA pada akun root
- Buat IAM user terpisah untuk pemakaian sehari-hari
- **Jangan pernah** memakai access key root di aplikasi

Akun root yang bocor berarti seluruh tagihan AWS jadi tanggungan Anda. Ini
bukan kehati-hatian berlebihan — kunci AWS yang tidak sengaja ter-commit adalah
salah satu penyebab tagihan besar yang paling sering terjadi.

## 2. Pilih region

Pilih satu region dan konsisten. Identitas domain, configuration set, dan kuota
semuanya terikat per region — memindahkannya nanti berarti mengulang verifikasi
dari awal.

Untuk pengiriman ke Indonesia, `ap-southeast-1` (Singapura) adalah pilihan
wajar: latensi rendah dan SES tersedia di sana. Periksa daftar region SES yang
berlaku saat Anda mendaftar sebelum menetapkan pilihan.

Nilai dummy yang terpasang sekarang: `AWS_REGION=ap-southeast-1`.

## 3. Verifikasi domain dan ambil token DKIM

Konsol SES → **Identities** → **Create identity** → pilih **Domain**.

Masukkan domain pengirim, bukan domain perusahaan:

```
blast.contoh.id
```

Aktifkan **Easy DKIM** dengan panjang kunci **RSA 2048-bit**. SES mengeluarkan
**tiga token**, masing-masing menjadi satu record CNAME:

```
<token1>._domainkey.blast.contoh.id  CNAME  <token1>.dkim.amazonses.com
<token2>._domainkey.blast.contoh.id  CNAME  <token2>.dkim.amazonses.com
<token3>._domainkey.blast.contoh.id  CNAME  <token3>.dkim.amazonses.com
```

Pasang ketiganya di DNS — caranya di [07-domain-dan-dns.md](07-domain-dan-dns.md)
bagian 4. Status identitas berubah dari `Pending` ke `Verified` setelah SES
melihat record-nya, biasanya dalam menit sampai jam.

Salin ketiga token ke `.env`:

```bash
SES_DKIM_TOKENS=token1,token2,token3
```

Setelah itu `npm run dns:check` memeriksa ketiganya benar-benar terpasang.

### MAIL FROM kustom

Pada identitas yang sama → **Custom MAIL FROM domain** → isi
`mail.blast.contoh.id`. SES memberi satu record MX dan satu TXT SPF; pasang
keduanya. Alasan kenapa ini penting ada di
[07-domain-dan-dns.md](07-domain-dan-dns.md) bagian 2.

Untuk perilaku saat MAIL FROM tidak tersedia, pilih **Reject message**. Pilihan
sebaliknya membuat SES diam-diam kembali memakai domain Amazon, dan keselarasan
SPF hilang tanpa gejala.

## 4. Keluar dari sandbox

Akun baru berada di sandbox. Batasannya membuat pengujian sungguhan tidak
mungkin:

- Hanya bisa mengirim ke alamat yang sudah diverifikasi satu per satu
- Kuota harian sangat kecil (biasanya 200 pesan per 24 jam)
- Laju kirim dibatasi sekitar 1 pesan per detik

Konsol SES → **Account dashboard** → **Request production access**.

Formulirnya minta penjelasan naratif, dan kualitas jawaban menentukan
diterima-tidaknya. Yang dinilai peninjau: dari mana alamat penerima berasal,
bagaimana orang berhenti berlangganan, dan apa yang Anda lakukan saat
pemantulan terjadi.

Jawaban yang menjawab ketiganya, sesuai dengan yang memang dibangun sistem ini:

> Kami mengirim email B2B ke kontak perusahaan yang kami kumpulkan dari sumber
> dengan dasar izin tercatat: formulir web, pameran dagang, referral mitra, dan
> alamat generik yang dipublikasikan perusahaan di situs resminya. Setiap
> kontak menyimpan sumber izin dan tanggalnya, dan kontak tanpa sumber izin
> tidak dapat masuk kampanye.
>
> Setiap pesan menyertakan identitas dan alamat fisik pengirim serta tautan
> berhenti berlangganan satu klik yang disisipkan di sisi server. Pengguna
> tidak dapat menghapusnya. Tautan berlaku seketika tanpa autentikasi.
>
> Kami memproses notifikasi pemantulan dan keluhan lewat SNS dan memasukkan
> alamatnya ke daftar penekanan permanen yang tidak memiliki operasi hapus di
> lapisan mana pun. Alamat hasil tebakan dikarantina dan wajib lolos verifikasi
> sebelum dapat dikirimi. Volume dibatasi jadwal pemanasan domain bertahap.

Jangan menuliskan ini kalau belum benar. Peninjau bisa memeriksa, dan
penolakan membuat pengajuan berikutnya lebih sulit.

Balasan biasanya datang dalam 24 jam kerja, kadang lebih lama. Kalau ditolak,
alasannya disebutkan dan pengajuan ulang diperbolehkan setelah diperbaiki.

Selama menunggu, verifikasi 2–3 alamat pribadi Anda sendiri sebagai penerima
uji — itu tetap bisa dilakukan di dalam sandbox, dan cukup untuk menguji jalur
pemantulan serta berhenti berlangganan.

Langkah lengkapnya, beserta alamat simulator yang memicu pemantulan dan keluhan
tanpa merusak reputasi, ada di [bagian 10](#10-uji-coba-dengan-alamat-pribadi-di-sandbox).

## 5. IAM user untuk aplikasi

Konsol IAM → **Users** → **Create user**. Jangan beri akses konsol; aplikasi
hanya butuh access key.

Lampirkan kebijakan inline dengan izin seminimal mungkin:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "KirimEmailKampanye",
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendRawEmail"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "ses:FromAddress": "blast@blast.contoh.id"
        }
      }
    },
    {
      "Sid": "BacaKuotaDanStatus",
      "Effect": "Allow",
      "Action": [
        "ses:GetSendQuota",
        "ses:GetSendStatistics",
        "ses:GetAccountSendingEnabled"
      ],
      "Resource": "*"
    }
  ]
}
```

`ses:FromAddress` pada kondisi membatasi kunci ini hanya bisa mengirim atas
nama satu alamat. Kalau kuncinya bocor, kerusakannya terbatas pada alamat itu,
bukan seluruh domain terverifikasi di akun.

Izin baca kuota dipakai `warmup-advance` untuk membandingkan batas internal
dengan batas yang benar-benar berlaku di SES.

Simpan access key sekali saat dibuat — secret tidak bisa ditampilkan ulang.
Masukkan ke `.env`, yang sudah masuk `.gitignore`.

## 6. Configuration set dan webhook pemantulan

Ini bagian yang paling sering ditunda dan paling mahal kalau ditunda.

**Buat configuration set.** SES → **Configuration sets** → **Create set**.
Nama yang dipakai konfigurasi sekarang: `marketing-blast-events`.

**Buat topik SNS.** SNS → **Topics** → **Create topic** → tipe **Standard**.

**Hubungkan.** Pada configuration set → **Event destinations** → **Add
destination** → pilih SNS, arahkan ke topik tadi. Event yang perlu dilanggan:

| Event | Kegunaan |
|---|---|
| `Bounce` | Pemantulan keras masuk daftar penekanan |
| `Complaint` | Keluhan spam masuk daftar penekanan |
| `Delivery` | Menandai penerima `delivered` |
| `Reject` | SES menolak sebelum terkirim |
| `Open` | Mengisi `opened_at` — **pemicu kampanye tindak lanjut** |
| `Click` | Mengisi `clicked_at` — **pemicu kampanye tindak lanjut** |

`Open` dan `Click` dulu tercatat sebagai "menyusul di Fase 4". Sekarang keduanya
wajib, dan alasannya bukan pelaporan: seluruh fitur tindak lanjut kampanye
berdiri di atas dua kolom itu. Tanpa keduanya dilanggan, `opened_at` dan
`clicked_at` tidak pernah terisi — satu-satunya pemicu yang masih bekerja adalah
`membalas`, dan setiap kontak pada akhirnya dinilai `diam` lalu berhenti
dikirimi. Kegagalan itu tidak memunculkan galat sama sekali.

Dua hal yang perlu diketahui sebelum menyalakannya:

* **Buka hanya terdeteksi kalau klien penerima memuat gambar pelacak.** Gmail
  memuatnya lewat proksi, jadi umumnya terbaca; sebagian besar klien perusahaan
  memblokirnya. Angka buka yang rendah karena itu belum tentu berarti tidak ada
  yang membaca — ini alasan `diam` tidak pernah otomatis menjadi penghapusan
  kontak.
* **Klik menuntut SES menulis ulang setiap tautan** menjadi domain pelacak.
  Tanpa custom redirect domain, tautannya menjadi `awstrack.me` — domain milik
  bersama yang reputasinya di luar kendali Anda dan terlihat oleh penerima.
  Kalau `Click` dinyalakan, siapkan subdomain pelacak sendiri di configuration
  set.

**Langganan HTTPS.** Pada topik SNS → **Create subscription** → protokol
HTTPS → endpoint `https://blast.contoh.id/webhooks/ses`.

Dua hal wajib pada endpoint ini, dan keduanya sering terlewat:

1. **Konfirmasi langganan.** SNS mengirim pesan bertipe `SubscriptionConfirmation`
   berisi `SubscribeURL`. Endpoint harus mengaksesnya sekali. Sebelum itu,
   status langganan tetap `PendingConfirmation` dan tidak ada event yang masuk.

2. **Verifikasi tanda tangan.** Setiap pesan SNS membawa tanda tangan dan URL
   sertifikat. Tanpa verifikasi, siapa pun yang tahu URL webhook bisa mengirim
   pemantulan palsu dan memasukkan alamat sembarangan ke daftar penekanan yang
   tidak punya operasi hapus. Terima hanya sertifikat dari host `amazonaws.com`.

Endpoint ini tidak berada di balik autentikasi — sama seperti
`/unsubscribe/:token`. Verifikasi tanda tangan itulah pengamanannya.

Pengerjaannya dijadwalkan Fase 2, bersamaan dengan driver pengiriman.

## 7. Biaya

SES menagih per pesan, tanpa biaya minimum bulanan. Kisaran yang berlaku lama
adalah sekitar **USD 0,10 per 1.000 email**, ditambah biaya lampiran per GB.
Cocokkan dengan halaman harga SES saat Anda mendaftar.

Pada volume yang ditargetkan produk ini — ratusan sampai belasan ribu email per
bulan — biaya SES praktis tidak signifikan dibanding sewa VPS. Yang perlu
diawasi justru SNS dan penyimpanan log kalau event disimpan lama.

Pasang **billing alert** di CloudWatch pada nominal kecil, misalnya USD 5.
Bukan karena SES mahal, tapi karena alert itu yang memberi tahu Anda lebih dulu
kalau ada kunci bocor dan dipakai orang lain.

## 8. Menyalakan di kode

Selama SES belum siap, sistem berjalan dengan driver dummy:

```
apps/api/src/mail/
├─ types.ts    Antarmuka MailDriver — batas antara menyusun dan mengirim
├─ dummy.ts    Menahan pesan, menulis .eml ke outbox, tidak mengirim apa pun
├─ ses.ts      Kerangka SES — melempar sampai diisi di Fase 2
└─ index.ts    Pemilih driver dari MAIL_DRIVER
```

Driver dummy menulis setiap pesan sebagai berkas `.eml` lengkap dengan header
`List-Unsubscribe`. Isinya bisa dibuka dan diperiksa:

```bash
docker compose exec api ls /app/var/outbox
docker compose exec api cat /app/var/outbox/<nama-berkas>.eml
```

Gunanya bukan sekadar simulasi. Sebelum satu pun email sungguhan keluar, di
situlah Anda memastikan identitas pengirim dan tautan berhenti berlangganan
benar-benar tersisip.

Saat driver SES sudah ditulis di Fase 2:

```bash
MAIL_DRIVER=ses
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-southeast-1
SES_CONFIGURATION_SET=marketing-blast-events
SES_DKIM_TOKENS=token1,token2,token3
```

Konfigurasi menolak start kalau `MAIL_DRIVER=ses` sementara kredensial atau
ketiga token DKIM belum lengkap. Itu disengaja: salah konfigurasi harus
berakhir pada proses tidak naik, bukan pada sistem yang tampak sehat tapi tidak
mengirim apa-apa.

`/health` ikut melaporkan keadaan ini:

```json
{
  "status": "ok",
  "database": "ok",
  "mail": {
    "driver": "dummy",
    "sends_real_email": false,
    "sender_domain": "blast.contoh.id"
  }
}
```

## 9. Prasyarat sebelum menyalakan pengiriman sungguhan

Daftar ini juga ada di kode, pada `SES_PREREQUISITES` di
[`apps/api/src/mail/ses.ts`](../apps/api/src/mail/ses.ts):

- [ ] Identitas domain terverifikasi di SES
- [ ] Tiga record CNAME DKIM terpasang dan berstatus verified
- [ ] MAIL FROM kustom terkonfigurasi (MX + SPF)
- [ ] DMARC terpasang, minimal `p=none`, dan laporannya sudah masuk
- [ ] Akun keluar dari sandbox
- [ ] Configuration set meneruskan event bounce dan keluhan ke webhook
- [ ] Jalur berhenti berlangganan dan pemantulan terbukti bekerja pada daftar
      sendiri

Butir terakhir tidak bisa dilewati. Kalau jalur pemantulan belum bekerja,
kerusakan reputasi terjadi tanpa terdeteksi — dan saat terdeteksi, yang rusak
sudah bukan sesuatu yang bisa diperbaiki dengan deploy.

## 10. Uji coba dengan alamat pribadi di sandbox

Bagian ini untuk pengujian dengan `lathif.sihab95@gmail.com` sebagai penerima,
sebelum ada satu pun alamat pelanggan yang dikirimi.

> **Prasyarat yang belum terpenuhi:** `apps/api/src/mail/ses.ts` masih kerangka
> yang melempar saat dipanggil. Menyetel `MAIL_DRIVER=ses` sekarang membuat
> setiap penerima ditandai `failed` dengan pesan "Driver SES belum
> diimplementasikan", bukan mengirim. Seluruh persiapan sisi AWS di bawah tetap
> dapat — dan sebaiknya — dikerjakan lebih dulu, karena verifikasi identitas dan
> langganan SNS memakan waktu tersendiri. Yang harus menunggu hanya langkah
> terakhir.

### 10.1 Sandbox menuntut KEDUA sisi terverifikasi

Di dalam sandbox, alamat penerima harus terverifikasi — dan pengirim memang
selalu harus. Ini yang paling sering salah dipahami: memverifikasi Gmail Anda
saja tidak cukup untuk mengirim.

Konsol SES → **Identities** → **Create identity** → **Email address** →
`lathif.sihab95@gmail.com`. SES mengirim email berisi tautan konfirmasi yang
berlaku 24 jam. Klik, dan statusnya menjadi `Verified`.

**Beberapa penerima dari satu kotak masuk.** Gmail mengantarkan alamat
ber-tanda-plus ke kotak masuk yang sama, dan SES memperlakukannya sebagai
identitas terpisah:

```
lathif.sihab95+uji1@gmail.com
lathif.sihab95+uji2@gmail.com
lathif.sihab95+uji3@gmail.com
```

Verifikasi masing-masing; ketiga email konfirmasinya mendarat di kotak masuk
yang sama. Ini yang membuat "kirim ke daftar kecil milik sendiri" benar-benar
menyerupai kampanye — beberapa penerima berbeda, satu tempat memeriksanya.

### 10.2 Pengirimnya tetap harus domain Anda

Godaannya adalah memverifikasi Gmail sebagai PENGIRIM juga, supaya tidak perlu
menunggu domain siap. Jangan, kecuali sekadar membuktikan koneksi API hidup.

SES menandatangani DKIM atas nama `amazonses.com` untuk identitas berbentuk
alamat email, dan envelope sender-nya juga milik Amazon. Pesan dengan
`From: ...@gmail.com` karena itu gagal keselarasan SPF maupun DKIM terhadap
`gmail.com` — Anda mengirim atas nama domain yang bukan milik Anda, lewat jalur
yang tidak diizinkan domain itu. Kebijakan DMARC `gmail.com` di luar kendali
kita dan arahnya semakin ketat; hasilnya berkisar dari masuk folder spam sampai
ditolak, dan yang Anda uji lalu bukan sistem ini melainkan toleransi Gmail.

Yang benar: selesaikan verifikasi domain pengirim di bagian 3 lebih dulu.
Selama sandbox, domain terverifikasi sudah cukup untuk mengirim — yang dibatasi
sandbox adalah penerimanya, dan itu diselesaikan 10.1.

### 10.3 Alamat simulator: menguji kerusakan tanpa merusak

Ini bagian terpenting, dan yang paling sering dilewati karena tidak kelihatan
mendesak.

Jalur pemantulan dan keluhan adalah yang menjaga reputasi domain. Cara menguji
keduanya BUKAN dengan mengarang alamat yang salah — pemantulan sungguhan tetap
tercatat pada reputasi Anda. SES menyediakan alamat simulator yang bekerja di
dalam sandbox, tidak perlu diverifikasi, dan **tidak dihitung ke dalam metrik
reputasi**:

| Alamat | Yang terjadi |
|---|---|
| `bounce@simulator.amazonses.com` | Pemantulan keras → masuk daftar penekanan |
| `complaint@simulator.amazonses.com` | Keluhan spam → masuk daftar penekanan |
| `success@simulator.amazonses.com` | Terkirim normal → `delivered` |
| `ooto@simulator.amazonses.com` | Balasan otomatis "sedang di luar kantor" |
| `suppressionlist@simulator.amazonses.com` | Ditolak karena daftar penekanan SES |

Susun satu kampanye uji berisi kelimanya ditambah alamat Gmail Anda, lalu
periksa hasilnya di basis data:

```sql
SELECT email, status, bounced_at, complained_at, replied_at, skip_reason
  FROM campaign_recipients WHERE campaign_id = '<id>';

SELECT email, reason FROM suppression;
```

Yang harus terbukti — dan ini daftar yang menentukan boleh-tidaknya melanjutkan:

- `bounce@` dan `complaint@` berakhir di tabel `suppression`, dengan alasan yang
  berbeda dan benar
- kontaknya ikut berubah menjadi `diblokir`
- mengirim ulang kampanye tidak lagi menyertakan keduanya
- `success@` bertanda `delivered`

`ooto@` layak diuji khusus sejak ada fitur tindak lanjut: balasan otomatis
"sedang di luar kantor" akan tercatat sebagai **balasan**, dan pemicu
`membalas` menganggapnya tanda ketertarikan. Itu memang perilaku yang dipilih —
menebak balasan otomatis dari subjeknya berarti menebak dalam beberapa bahasa
dan tetap meleset — tapi Anda perlu melihatnya sekali sendiri supaya tahu apa
yang harus dibersihkan sebelum kampanye lanjutan berjalan.

**Menandai spam di Gmail tidak menghasilkan notifikasi keluhan.** Gmail tidak
menyediakan umpan balik keluhan per pengirim seperti Yahoo atau Outlook, jadi
`complained_at` tidak akan pernah terisi dari sana. Satu-satunya cara menguji
jalur keluhan adalah alamat simulator di atas. Kalau ini tidak diketahui, mudah
menyimpulkan "jalur keluhan sudah bekerja" dari percobaan yang memang tidak
pernah mengirim apa pun.

### 10.4 Webhook dan tautan berhenti berlangganan perlu alamat publik

Dua hal berhenti bekerja saat berjalan di laptop:

1. **SNS tidak dapat menjangkau `localhost`.** Tanpa endpoint publik, tidak ada
   satu pun event pemantulan yang masuk — dan yang terlihat justru "semuanya
   lancar", karena tidak ada yang melaporkan sebaliknya.
2. **Tautan berhenti berlangganan di email tidak dapat diklik.** Anda membukanya
   dari Gmail, bisa jadi dari ponsel; `http://localhost:3000` di sana menunjuk
   ke ponsel Anda sendiri.

Pakai terowongan HTTPS sementara (`cloudflared tunnel --url http://localhost:3000`
atau `ngrok http 3000`), lalu arahkan keduanya ke URL itu:

```bash
PUBLIC_BASE_URL=https://<nama-acak>.trycloudflare.com
```

Langganan SNS diarahkan ke `https://<nama-acak>.trycloudflare.com/webhooks/ses`.
SNS menuntut HTTPS dengan sertifikat sah — terowongan menyediakannya.

Alamat terowongan berubah setiap kali dijalankan ulang, jadi langganan SNS-nya
perlu dibuat ulang juga. Merepotkan, tapi lebih jujur daripada menunda pengujian
webhook sampai setelah kampanye pertama.

### 10.5 Menyiapkan sisi aplikasi

Sistem ini sekarang multi-tenant, jadi kontak ujinya harus punya pemilik.
Paling sederhana: pakai pelanggan `bawaan`, dan buat pengguna untuk masuk.

```bash
cd apps/api
npm run pengguna -- admin bawaan lathif.sihab95@gmail.com "Lathif"
```

Lalu lewat antarmuka, masuk sebagai pengguna itu dan:

1. Impor atau tambahkan kontak `lathif.sihab95@gmail.com` beserta alamat
   simulator. Sumber izin apa pun yang jujur — untuk alamat sendiri,
   `pelanggan_existing` masuk akal.
2. Pastikan status kontaknya `aktif`. Kontak hasil tebakan
   (`email_origin = guessed`) masuk karantina dan ditolak aktivasi kecuali
   pengecualiannya diminta eksplisit — untuk uji ini pakai `manual` atau
   `found`.
3. Susun kampanye, jalankan pra-kirim, kirim. Tahap pemanasan 1 memberi 50
   pesan per hari; jauh lebih dari cukup.
4. Worker mengambil antrean tiap menit. Kalau berjalan lewat `npm run dev`,
   pastikan proses worker-nya hidup — antrean yang tidak bergerak paling sering
   berarti worker-nya memang tidak jalan.

### 10.6 Yang diperiksa di kotak masuk

Buka pesannya di Gmail dan periksa satu per satu:

- **Identitas dan alamat fisik pengirim ada di kaki pesan.** Keduanya
  disisipkan server, jadi kalau hilang berarti ada yang salah di penyusun pesan
  — bukan di isi yang Anda tulis.
- **Gmail menampilkan tombol "Berhenti berlangganan"** di samping nama
  pengirim. Itu berasal dari header `List-Unsubscribe` dan
  `List-Unsubscribe-Post`; kalau tidak muncul, header-nya tidak sampai.
- **Klik tautan berhenti berlangganan.** Harus langsung berlaku, tanpa halaman
  konfirmasi bertingkat dan tanpa diminta masuk akun. Setelah itu, alamatnya ada
  di `suppression` dan kontaknya `diblokir`.
- **Kirim ulang kampanye yang sama.** Alamat yang sudah berhenti berlangganan
  harus terlewat dengan `skip_reason`, bukan terkirim lagi.
- **Periksa header pesan** (Gmail → "Tampilkan yang asli"): `SPF: PASS`,
  `DKIM: PASS`, `DMARC: PASS`. Ketiganya harus selaras dengan domain pengirim
  Anda, bukan dengan `amazonses.com`.

Butir terakhir adalah yang membedakan "email sampai" dari "email sampai dan
akan terus sampai". Selaras sejak awal jauh lebih murah daripada memperbaiki
reputasi yang sudah turun.

### 10.7 Setelah uji coba

Alamat Gmail Anda ada di daftar penekanan setelah menguji berhenti berlangganan,
dan daftar itu **tidak punya operasi hapus** — di lapisan mana pun, termasuk
lewat SQL sebagai peran aplikasi. Itu memang dirancang begitu.

Untuk mengulang pengujian, pakai alamat ber-tanda-plus yang berbeda
(`+uji4`, `+uji5`, dan seterusnya). Jangan menambahkan jalur penghapusan
penekanan demi kenyamanan pengujian — begitu jalur itu ada, ia akan dipakai di
produksi juga.

Kalau basis data pengembangan perlu benar-benar bersih, hapus datanya sebagai
pemilik skema, bukan lewat aplikasi:

```bash
docker compose exec db psql -U blast -d marketing_blast \
  -c "DELETE FROM suppression WHERE email LIKE 'lathif.sihab95%';"
```

## Kesalahan yang mahal

- **Memakai access key root.** Tagihan tak terbatas kalau bocor.
- **Menunda pengajuan keluar sandbox.** Menghambat seluruh Fase 2.
- **Menyalakan pengiriman sebelum webhook jalan.** Pemantulan tidak tercatat,
  alamat mati dikirimi berulang, reputasi turun diam-diam.
- **Melewatkan verifikasi tanda tangan SNS.** Siapa pun bisa mengisi daftar
  penekanan permanen Anda.
- **Mengirim ke daftar besar untuk uji coba.** Uji pada daftar sendiri lebih
  dulu — kerusakan reputasi tidak bisa dibatalkan.
- **Menguji pemantulan dengan alamat karangan.** Pemantulannya sungguhan dan
  tercatat pada reputasi Anda. Pakai alamat simulator (bagian 10.3).
- **Mengirim atas nama alamat `@gmail.com`.** Gagal keselarasan SPF dan DKIM,
  dan yang Anda uji jadi toleransi Gmail, bukan sistem ini (bagian 10.2).
- **Menyimpulkan jalur keluhan bekerja karena sudah menandai spam di Gmail.**
  Gmail tidak mengirim umpan balik keluhan; `complained_at` tidak akan pernah
  terisi dari sana.
- **Berpindah region setelah berjalan.** Verifikasi, configuration set, dan
  kuota tidak ikut pindah.
