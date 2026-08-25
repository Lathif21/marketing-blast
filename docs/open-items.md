# Open Items

Hal yang belum dikerjakan, beserta alasannya. Dokumen ini diperbarui setiap
kali sesuatu selesai atau muncul temuan baru — bukan daftar sekali tulis.

Terakhir diperbarui: setelah Fase 2 sebagian (kampanye, preflight, send-worker).

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
   berlangganan, pastikan masuk daftar penekanan. Kirim ke alamat yang sengaja
   salah, pastikan bounce tertangkap webhook dan masuk penekanan.
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

### B4. `retention-sweep` masih kosong

Kebijakan retensi belum diterapkan. Belum mendesak selama volume kontak masih
kecil, tapi merupakan kewajiban UU PDP yang tercantum di PRD.

---

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

### D1. Migrasi 006 dan 007 belum dijalankan terhadap database sungguhan

**Ini yang paling perlu diperiksa lebih dulu.**

Kedua berkas migrasi ditulis dan lolos typecheck, tapi belum pernah dijalankan
terhadap PostgreSQL. Kesalahan sintaks SQL tidak terdeteksi TypeScript.

Sebelum melanjutkan apa pun:

```bash
docker compose up -d db
cd apps/api && npm run migrate
```

Pastikan `schema_migrations` memuat `006_campaigns.sql` dan
`007_domain_health.sql`, dan seluruh tabel terbentuk.

### D2. Alur kirim belum diuji end-to-end

`send-worker` sudah ditulis dan typecheck bersih, tapi belum pernah berjalan
terhadap data sungguhan. Yang perlu dibuktikan dengan driver `dummy`:

- Kampanye dengan penerima melebihi kuota berhenti di batas, bukan mengirim semua
- Baris yang tersisa tetap `queued`, bukan `failed`
- Kontak yang di-suppress setelah antrean disusun benar-benar ter-skip
- `domain_daily_sends` bertambah sesuai jumlah terkirim
- Kampanye berpindah ke `selesai` hanya kalau tidak ada baris `queued`

### D3. Segmentasi masih sangat sederhana

`segment_filter` baru mendukung `consent_source` dan `domain`. Kriteria lain
— rentang tanggal impor, batch tertentu, industri — belum ada.

Cukup untuk pengujian internal, kemungkinan tidak cukup untuk klien.

### D4. Belum ada autentikasi

Seluruh endpoint terbuka. Dapat diterima selama berjalan lokal atau di balik
jaringan tertutup, **tidak dapat diterima** begitu dapat diakses dari internet.

Ini prasyarat sebelum klien menyentuh sistem, bukan penyempurnaan.

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

## E. Butuh keputusan, bukan kode

| Hal | Pertanyaan |
|---|---|
| Layanan verifikasi alamat | Mana yang dipakai, berapa tarifnya? (B3) |
| Kuota enhancement | Berapa permintaan per bulan sebelum berbiaya tambahan? |
| Model penyerahan | Instalasi terpisah per klien, atau multi-tenant? |
| Kriteria siap jual | Setelah berapa lama pemakaian internal, atas dasar hasil apa? |
| Peninjauan hukum | Kapan anggaran konsultan Rp 12 juta dipakai? |

Empat pertanyaan pertama sudah muncul di PRD dan belum terjawab. Yang terakhir
sebaiknya dilakukan sebelum sistem menyentuh data klien sungguhan, bukan
sesudahnya.

---

## Urutan yang disarankan

1. **D1** — jalankan migrasi, buktikan skemanya benar
2. **D2** — uji alur kirim dengan driver `dummy`
3. **C1 dan C2** — sambungkan dua layar terakhir, produk jadi utuh dari ujung ke ujung
4. **D4** — autentikasi, sebelum apa pun terekspos
5. **A1** — nyalakan SES saat DP masuk
6. **B1, B2** — kesehatan domain, setelah ada data pengiriman sungguhan

Nomor 1 sampai 3 tidak membutuhkan SES sama sekali, jadi dapat dikerjakan
sambil menunggu.
