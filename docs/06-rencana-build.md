# 06 — Rencana Build

Dikerjakan satu orang paruh waktu. Urutan disusun supaya ada yang benar-benar
bisa dipakai sedini mungkin, bukan supaya semua bagian selesai bersamaan.

## Fase 0 — Persiapan (1 minggu)

- Pecah `App.tsx` menjadi berkas per layar dan komponen
- Pindahkan data tiruan ke `lib/mock.ts`
- Kerjakan revisi desain nomor 1 dan 2 dari
  [05-revisi-desain.md](05-revisi-desain.md)
- Siapkan Docker Compose: PostgreSQL, API, worker
- Daftarkan domain pengirim, konfigurasi SPF, DKIM, DMARC
- Ajukan akun Amazon SES keluar dari sandbox — **mulai sekarang**, prosesnya
  makan waktu dan menghambat semua pengujian pengiriman

## Fase 1 — Kontak (2–3 minggu)

Skema database, impor, daftar kontak.

Selesai bila:

- Berkas CSV dan `.enc` dapat diunggah, dipetakan, dan disimpan
- Keluaran Contact Harvester terdeteksi otomatis dari susunan kolomnya
- `email_source = guessed` masuk karantina
- `consent_source` wajib dan memblokir impor bila kosong
- Batch tercatat dan dapat dibatalkan
- Daftar kontak dapat difilter berdasarkan status dan sumber izin

Belum ada pengiriman apa pun di fase ini.

## Fase 2 — Pengiriman (3–4 minggu)

Bagian terberat.

Selesai bila:

- Kampanye dapat disusun dan masuk antrean
- Worker mengirim melalui SES sesuai batas harian
- Identitas pengirim dan tautan berhenti berlangganan tersisip di server
- Tautan berhenti berlangganan berfungsi tanpa autentikasi
- Webhook SES memasukkan pemantulan dan keluhan ke daftar penekanan
- `preflight` memblokir kampanye yang gagal pemeriksaan

**Uji pada daftar kecil milik sendiri lebih dulu.** Jangan kirim ke daftar
sungguhan sebelum jalur pemantulan dan berhenti berlangganan terbukti bekerja
— kalau keduanya belum jalan, kerusakan reputasi terjadi tanpa terdeteksi.

## Fase 3 — Kesehatan domain (2 minggu)

- Perhitungan bounce dan keluhan berjalan
- Jadwal pemanasan aktif dan menahan kampanye yang melebihi kuota
- `warmup-advance` menaikkan tahap hanya bila metrik sehat
- Verifikasi alamat untuk kontak karantina
- Revisi desain nomor 4 (runway pemanasan)

Setelah fase ini produk sudah aman dipakai untuk kampanye sungguhan.

## Fase 4 — Laporan & penyempurnaan (2 minggu)

- Funnel per kampanye dari data nyata
- Dampak reputasi per kampanye
- Revisi desain nomor 5 dan 6
- Alur permintaan penghapusan data
- Pekerjaan retensi bulanan

## Fase 5 — Kesiapan komersial

Belum dijadwalkan. Prasyaratnya bukan waktu, melainkan bukti:

- Dipakai internal minimal 2–3 bulan dengan kampanye sungguhan
- Angka nyata: berapa kampanye, berapa kontak, bagaimana metrik kesehatan
- Prosedur pemasangan untuk klien baru terdokumentasi
- Model dukungan disepakati — jam kerja saja, dengan target respons per
  tingkat urgensi

Menjual sebelum ada bukti pemakaian berarti klien pertama menjadi penguji,
dan itu risiko yang ditanggung reputasi, bukan hanya jadwal.

## Total

Sekitar **10–13 minggu** sampai siap dipakai internal, dengan alokasi paruh
waktu.

## Risiko utama

| Risiko | Mitigasi |
|---|---|
| SES tertahan di sandbox | Ajukan di Fase 0, jangan menunggu |
| Reputasi rusak saat pengujian | Uji pada daftar sendiri; pemanasan aktif sejak awal |
| Lingkup melebar | Setiap fitur baru harus memperkuat rantai impor → kirim → laporan |
| Bus factor satu orang | Tulis dokumentasi teknis sejalan dengan kode; simpan kredensial di tempat yang dapat diakses manajemen |
