# Marketing Blast — Dokumentasi Pengembangan

Platform kampanye email B2B dengan kepatuhan dan perlindungan reputasi domain
yang ditegakkan sistem, bukan diserahkan ke kedisiplinan pengguna.

## Yang membedakan produk ini

Mengirim email massal sudah tersedia di banyak layanan dan harganya murah.
Yang sulit adalah mengirim tanpa merusak reputasi domain pengirim — dan
kerusakan itu menular ke seluruh email dari domain yang sama, termasuk
korespondensi operasional sehari-hari.

Karena itu tiga hal berikut **tidak dapat dinonaktifkan pengguna**:

1. Identitas pengirim dan tautan berhenti berlangganan pada setiap pesan
2. Daftar penekanan (suppression) yang bersifat permanen
3. Batas harian pemanasan domain

Kalau salah satu bisa dimatikan, produk ini kehilangan alasan keberadaannya.

## Status saat ini

| Bagian | Status |
|---|---|
| Prototype UI (6 layar) | Selesai — Figma Make, React + Tailwind + shadcn/ui |
| Backend | Kerangka siap — API, worker, Docker Compose berjalan |
| Domain pengirim & DNS | Belum dibuat — berjalan dengan nilai dummy |
| Integrasi Amazon SES | Belum dimulai — driver dummy menahan semua pengiriman |
| Integrasi Contact Harvester | Skema sudah dipetakan, implementasi belum |

Prototype: `github.com/Lathif21/marketing-blast`
Sumber data internal: `github.com/Lathif21/email_scrapper`

## Peta dokumen

| Berkas | Isi |
|---|---|
| [01-arsitektur.md](01-arsitektur.md) | Susunan teknis, struktur repo, keputusan dan alasannya |
| [02-model-data.md](02-model-data.md) | Skema tabel, status kontak, integrasi Contact Harvester |
| [03-layar-dan-alur.md](03-layar-dan-alur.md) | Spesifikasi tiap layar, celah antara prototype dan target |
| [04-aturan-kepatuhan.md](04-aturan-kepatuhan.md) | Aturan yang ditegakkan kode — bagian paling penting |
| [05-revisi-desain.md](05-revisi-desain.md) | Usulan perubahan arah visual agar lebih terasa digital marketing |
| [06-rencana-build.md](06-rencana-build.md) | Urutan pengerjaan dan definisi selesai |
| [07-domain-dan-dns.md](07-domain-dan-dns.md) | Domain pengirim, SPF, DKIM, DMARC — cara memasang dan memeriksanya |
| [08-amazon-ses.md](08-amazon-ses.md) | Akun AWS, verifikasi domain, keluar sandbox, webhook pemantulan |
| [09-eksekusi-fase-1.md](09-eksekusi-fase-1.md) | Catatan eksekusi fase pertama |
| [11-integrasi-gmail.md](11-integrasi-gmail.md) | Menyambungkan kotak masuk: deteksi balasan dan impor korespondensi |
| [12-uji-regresi.md](12-uji-regresi.md) | **Cara menjalankan uji end-to-end**, apa yang dibuktikan, dan cara membacanya saat gagal |
| [open-items.md](open-items.md) | Yang belum dikerjakan, beserta alasannya |

## Menjalankan secara lokal

Tiga proses, tiga terminal. Salin `.env.example` menjadi `.env` lebih dulu.

```bash
npm run dev:db      # PostgreSQL lewat Docker
npm run dev:api     # bangun, migrasikan, lalu jalankan API di :3000
npm run dev         # Vite di :5173
```

`npm run dev:api` menjalankan migrasi setiap kali, dan migrasinya idempoten —
jadi tidak perlu diingat kapan terakhir dijalankan.

## Menjalankan uji

```bash
cd apps/api
npm run check       # typecheck + uji unit, tanpa basis data
npm run test:e2e    # uji regresi end-to-end, butuh PostgreSQL berjalan
```

Uji regresi memakai basis data TERPISAH berakhiran `_regresi` dan menolak
berjalan di luar itu — ia menjalankan `DELETE FROM contacts` untuk membersihkan
fixture. Rinciannya, termasuk apa yang TIDAK dibuktikannya, ada di
[12-uji-regresi.md](12-uji-regresi.md).

Layar impor, kontak, dan daftar suppres membaca dari API. Kalau API belum
hidup, ketiganya menampilkan pesan yang menyebutkan perintah di atas, bukan
galat jaringan mentah.

Menghentikan basis data: `npm run dev:stop`.

### Menyetel `.env`

| Variabel | Untuk apa |
|---|---|
| `POSTGRES_HOST_PORT` | Ganti bila 5432 sudah dipakai proses lain di mesin Anda |
| `DATABASE_URL` | Dipakai saat API dijalankan di host; Docker Compose menyusun miliknya sendiri |
| `APP_DATABASE_URL` | Peran aplikasi — tanpa hak DELETE pada `suppression` |
| `UNSUBSCRIBE_SECRET` | Wajib, minimal 32 karakter: `openssl rand -hex 32` |
| `MAIL_DRIVER` | Biarkan `dummy` sampai prasyarat di [08-amazon-ses.md](08-amazon-ses.md) terpenuhi |

## Konteks pengembangan

Dikerjakan satu orang secara paruh waktu. Konsekuensinya ada di setiap
keputusan teknis: komponen infrastruktur dijaga sesedikit mungkin, dan fitur
yang tidak memperkuat rantai impor → kampanye → kirim → laporan ditunda.

Baca [04-aturan-kepatuhan.md](04-aturan-kepatuhan.md) lebih dulu sebelum
menyentuh kode. Sebagian besar keputusan desain di dokumen lain berasal dari
sana.

Selama domain pengirim dan akun SES belum ada, sistem berjalan dengan nilai
dummy dan `MAIL_DRIVER=dummy` — tidak ada satu pun email yang bisa keluar.
Menggantinya dengan nilai sungguhan dijelaskan di
[07-domain-dan-dns.md](07-domain-dan-dns.md) dan
[08-amazon-ses.md](08-amazon-ses.md).
