# Open Items

Hal yang belum dikerjakan, beserta alasannya. Dokumen ini diperbarui setiap
kali sesuatu selesai atau muncul temuan baru — bukan daftar sekali tulis.

Terakhir diperbarui: setelah tindak lanjut kampanye dan multi-tenant +
superadmin.

---

## A. Terblokir oleh keputusan komersial

### A1. Integrasi Amazon SES belum dinyalakan

**Status:** akun SES sudah disetujui, tapi belum diintegrasikan. Menunggu DP klien.

`MAIL_DRIVER` masih `dummy`. Seluruh jalur pengiriman sudah terbangun dan
berjalan, hanya berhenti di driver — pesan dicatat, tidak keluar ke internet.

**Yang perlu dilakukan saat DP masuk:**

1. Isi kredensial SES di `.env` (`docs/08-amazon-ses.md` §5)
2. Pasang record DNS: SPF, DKIM, DMARC, MAIL FROM (`docs/07-domain-dan-dns.md`)
3. Jalankan `npm run dns:check` sampai seluruhnya hijau
4. Daftarkan endpoint webhook `/webhooks/ses` di configuration set SES
5. **Uji kirim ke 5–10 alamat milik sendiri lebih dulu.** Klik tautan berhenti
   berlangganan, pastikan masuk daftar penekanan. Untuk pemantulan dan keluhan,
   pakai alamat simulator SES — mengarang alamat yang salah menghasilkan
   pemantulan sungguhan yang tercatat pada reputasi Anda. Langkah lengkapnya di
   [08-amazon-ses.md bagian 10](08-amazon-ses.md#10-uji-coba-dengan-alamat-pribadi-di-sandbox).
6. Baru ganti `MAIL_DRIVER=ses`

Langkah 5 tidak boleh dilewati. Jalur `dummy` dibangun justru supaya langkah
ini bisa dilakukan tanpa risiko, dan melewatinya berarti mekanisme deteksi
kerusakan belum pernah terbukti bekerja saat pengiriman sungguhan dimulai.

**Risiko bila dilewati:** kampanye pertama berjalan, bounce dan keluhan tidak
tertangkap, reputasi domain rusak tanpa terlihat di dashboard — karena angka
yang seharusnya menunjukkan masalah tidak pernah sampai ke sistem.

---

## B. Belum dikerjakan — Fase 3

### B1. `health-recalc` masih kosong

Rata-rata bergerak bounce dan keluhan 7 hari belum dihitung. Tabel dan indeks
sudah siap (`cr_sent_at_idx` pada `campaign_recipients`).

Sebelum ada pengiriman sungguhan, tidak ada yang bisa dihitung — jadi ini
memang menunggu A1.

### B2. `warmup-advance` masih kosong

Kenaikan tahap pemanasan belum otomatis. Saat ini tahap hanya bisa dinaikkan
manual lewat `UPDATE domain_health SET warmup_stage = ...`.

**Catatan penting saat mengisinya:** kenaikan hanya boleh terjadi kalau bounce
dan keluhan berada dalam batas aman (`AMBANG` di `domain/warmup.ts`), bukan
karena hari berganti. Menaikkan volume saat metrik memburuk mempercepat
kerusakan, bukan memperbaikinya. Ini alasan `hariPalingCepat` dinamai
demikian — itu syarat minimum, bukan jadwal.

### B3. `verify-worker` masih kosong

Kontak berstatus `karantina` belum diverifikasi otomatis, sehingga belum ada
jalan untuk menaikkannya jadi `aktif` selain manual.

Dampaknya nyata sekarang: kontak hasil impor `email_source = guessed`
menumpuk di karantina dan tidak akan pernah terkirimi. Untuk pengujian
internal ini bisa disiasati dengan `UPDATE contacts SET status = 'aktif'`,
tapi untuk penggunaan sungguhan verifikasi alamat perlu ada — justru alamat
inilah yang paling mungkin memantul.

**Butuh keputusan:** layanan verifikasi mana yang dipakai dan berapa tarifnya.
Belum ditentukan.

### B4. `retention-sweep` melaporkan, belum menghapus

Sudah terisi: pekerjaan ini menghitung kontak berstatus `diam` dan
melaporkannya. Penghapusannya sengaja tetap manual lewat
`POST /contacts/retensi/hapus` — alasannya ada di `jobs/respons-worker.ts`.

Yang belum: kebijakan retensi untuk kontak yang TIDAK pernah dikirimi sama
sekali. `diam` hanya berlaku setelah ada pengiriman, jadi kontak impor yang
tidak pernah masuk kampanye mana pun belum tersentuh kebijakan apa pun.

---

### B5. Verifikasi jalur event SES belum dilakukan sungguhan

`opened_at`, `clicked_at`, dan `delivered_at` sekarang terisi lewat
`/webhooks/ses`, tapi belum pernah diuji dengan notifikasi SES sungguhan —
payload tiruannya saja yang diuji.

Ini menentukan seluruh fitur tindak lanjut: tanpa event buka dan klik yang
masuk, satu-satunya pemicu yang bekerja adalah `membalas`, dan setiap kontak
pada akhirnya dinilai `diam`. Saat A1 dikerjakan, **event destination pada
configuration set harus mengaktifkan Delivery, Open, dan Click** — bukan hanya
Bounce dan Complaint.

Untuk balasan, `notificationType: Received` butuh receipt rule tersendiri.
Selama itu belum ada, jalur manual di layar Tindak Lanjut yang dipakai.

## C. Belum dikerjakan — frontend

### C1. `CampaignBuilderScreen` masih memakai mock

Endpoint sudah tersedia semua: `POST /campaigns`, `PATCH /campaigns/:id`,
`POST /campaigns/:id/preflight`, `POST /campaigns/:id/send`.

**Yang paling penting saat menyambungkannya:** langkah tinjau harus
menampilkan hasil `preflight` apa adanya, termasuk keadaan terblokir. Rancangan
keadaan terblokir ada di `03-layar-dan-alur.md` §4 — nadanya menjelaskan dan
menawarkan jalan keluar, bukan menghukum.

Respons `preflight` sudah menyediakan `tanggal_muat` supaya UI dapat menawarkan
"jadwalkan pada tanggal X" tanpa menghitung sendiri.

### C2. `ReportScreen` masih memakai mock

Endpoint `GET /campaigns/:id/report` sudah ada, lengkap dengan
`dampak_reputasi`.

Perhatikan field `sumber`: bernilai `belum_ada_pengiriman` ketika belum ada
yang terkirim. Jangan tampilkan 0% dalam keadaan itu — 0% terbaca sebagai
"sangat sehat", padahal artinya "belum ada yang bisa diukur". Ini kekeliruan
yang sama yang sudah dihindari di `/domain/health`.

### C3. Revisi desain belum dikerjakan

Dari `05-revisi-desain.md`, yang belum:

| Revisi | Usaha | Dampak |
|---|---|---|
| Runway pemanasan domain | Sedang | Tinggi |
| Baris subjek sebagai elemen utama | Sedang | Tinggi |
| Momen kirim | Sedang | Sedang |

Revisi disiplin monospace dan perbaikan data tiruan LinkedIn sudah selesai.

---

## D. Utang teknis

### D1. Migrasi — SUDAH dijalankan (selesai)

Seluruh migrasi `001` sampai `010` sudah diterapkan terhadap PostgreSQL
sungguhan. Tetap dicatat di sini sebagai pengingat urutannya untuk instalasi
baru:

```bash
docker compose up -d db
cd apps/api && npm run migrate
npm run pengguna -- superadmin <email> "<nama>"
```

### D2. Alur kirim — SUDAH diuji end-to-end (selesai)

`npm run test:e2e` menjalankan 114 pemeriksaan terhadap PostgreSQL sungguhan
dengan driver `dummy`, mencakup seluruh butir yang dulu terdaftar di sini —
batch berhenti tepat di kuota, sisa baris tetap `queued`, penekanan setelah
antrean tersaring, penghitung harian bertambah tepat, kampanye hanya `selesai`
kalau tidak ada `queued` — ditambah isolasi antar-pelanggan, pembekuan, sesi,
dan tindak lanjut kampanye.

Uji ini memakai basis data terpisah berakhiran `_regresi` dan menolak berjalan
di luar itu (`regression-guard.ts`), karena ia menjalankan
`DELETE FROM contacts` untuk membersihkan fixture.

**Yang masih belum diuji end-to-end** adalah pengiriman dengan driver `ses`
sungguhan — lihat A1 dan B5.

### D3. Segmentasi masih sederhana

`segment_filter` mendukung `consent_source`, `domain`, `contact_ids`,
`respons`, `kecuali_respons`, dan `respons_kampanye` (kriteria tindak lanjut).
Yang belum ada: rentang tanggal impor, batch tertentu, industri.

Cukup untuk pengujian internal, kemungkinan tidak cukup untuk klien.

### D4. Autentikasi — SUDAH ADA, dengan tiga batas yang perlu diketahui

Sesi berbasis cookie `HttpOnly`, kata sandi scrypt, peran
`superadmin`/`admin`/`operator`, dan isolasi antar-pelanggan yang ditegakkan
Row Level Security. Jalan masuk pertama lewat `npm run pengguna`.

Yang belum, dan sebaiknya tidak dianggap sudah:

1. **Pembatasan percobaan masuk hanya di memori proses.** Delapan percobaan
   per sepuluh menit per (IP, email), dan penghitungnya TIDAK dibagi
   antar-proses. Begitu ada lebih dari satu proses API, batas efektifnya
   berkali lipat. Yang benar untuk keadaan itu adalah pembatasan di proksi,
   bukan tabel penghitung yang membuat setiap login menulis ke basis data.
2. **Tidak ada pemulihan kata sandi mandiri.** Superadmin yang menyetelnya
   ulang. Ini disengaja — mengirim email pemulihan berarti memakai domain
   pengirim untuk hal di luar kampanye — tapi berarti superadmin menjadi titik
   tunggal, dan superadmin yang lupa sandinya sendiri hanya dapat pulih lewat
   `npm run pengguna -- sandi`.
3. **Belum ada 2FA.** Untuk akun superadmin, yang memegang akses ke data
   seluruh pelanggan, ini pantas menjadi syarat sebelum instalasi terbuka ke
   internet.

### D5. `pakaiKuota` menaikkan penghitung sebelum pengiriman berhasil

Kuota dipakai lebih dulu, lalu pesan dikirim. Kalau pengiriman gagal, kuota
tetap terpakai.

Ini disengaja: lebih baik kehilangan satu slot kuota daripada berisiko
melampaui batas saat ada beberapa proses berjalan. Tapi kalau tingkat
kegagalan tinggi, kuota harian terbuang lebih cepat dari seharusnya.

Pantau setelah pengiriman sungguhan berjalan. Kalau jadi masalah, pindahkan
penambahan penghitung ke setelah pengiriman berhasil dan terima risiko
sedikit terlampaui.

---

### D6. Domain pengirim per pelanggan belum punya alur

Skema sudah menjamin satu domain hanya dapat dimiliki satu pelanggan
(`domain_health.domain` tetap kunci primer global). Yang belum ada adalah alur
untuk MENETAPKANNYA: saat ini baris `domain_health` terbentuk sendiri dari
`config.sender.domain` — satu nilai untuk seluruh proses.

Akibatnya, pada instalasi multi-tenant sungguhan, pelanggan kedua akan memakai
domain pengirim pelanggan pertama. Itu harus diselesaikan SEBELUM pelanggan
kedua benar-benar mengirim: `sender_domain` perlu menjadi milik pelanggan
(kolom di `tenants`), dengan pemeriksaan DNS dan pemanasan per domain.

Ini konsekuensi paling penting dari keputusan multi-tenant, dan satu-satunya
bagiannya yang belum lengkap.

## E. Butuh keputusan, bukan kode

| Hal | Pertanyaan |
|---|---|
| Layanan verifikasi alamat | Mana yang dipakai, berapa tarifnya? (B3) |
| Kuota enhancement | Berapa permintaan per bulan sebelum berbiaya tambahan? |
| Kriteria siap jual | Setelah berapa lama pemakaian internal, atas dasar hasil apa? |
| Peninjauan hukum | Kapan anggaran konsultan Rp 12 juta dipakai? |

Empat pertanyaan pertama sudah muncul di PRD dan belum terjawab. Yang terakhir
sebaiknya dilakukan sebelum sistem menyentuh data klien sungguhan, bukan
sesudahnya.

---

## Urutan yang disarankan

1. **D6** — domain pengirim per pelanggan. Ini yang menahan pelanggan KEDUA
   dari mengirim, dan satu-satunya bagian multi-tenant yang belum lengkap
2. **D4 butir 1 dan 3** — pembatasan login di proksi dan 2FA superadmin,
   sebelum instalasi terbuka ke internet
3. **C2** — sambungkan `ReportScreen`, produk jadi utuh dari ujung ke ujung
4. **A1** — nyalakan SES saat DP masuk, dengan event destination Delivery,
   Open, dan Click (lihat B5) — tanpanya tindak lanjut tidak punya pemicu
   selain balasan
5. **B1, B2** — kesehatan domain, setelah ada data pengiriman sungguhan

Nomor 1 sampai 3 tidak membutuhkan SES sama sekali, jadi dapat dikerjakan
sambil menunggu.
