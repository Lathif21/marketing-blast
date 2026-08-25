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

`Open` dan `Click` menyusul saat laporan dikerjakan di Fase 4.

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

## Kesalahan yang mahal

- **Memakai access key root.** Tagihan tak terbatas kalau bocor.
- **Menunda pengajuan keluar sandbox.** Menghambat seluruh Fase 2.
- **Menyalakan pengiriman sebelum webhook jalan.** Pemantulan tidak tercatat,
  alamat mati dikirimi berulang, reputasi turun diam-diam.
- **Melewatkan verifikasi tanda tangan SNS.** Siapa pun bisa mengisi daftar
  penekanan permanen Anda.
- **Mengirim ke daftar besar untuk uji coba.** Uji pada daftar sendiri lebih
  dulu — kerusakan reputasi tidak bisa dibatalkan.
- **Berpindah region setelah berjalan.** Verifikasi, configuration set, dan
  kuota tidak ikut pindah.
