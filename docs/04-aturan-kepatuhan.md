# 04 — Aturan Kepatuhan

Dokumen ini berisi aturan yang **ditegakkan kode**, bukan kebijakan tertulis.
Kalau sebuah aturan hanya ada di dokumen dan tidak ada di kode, anggap aturan
itu belum diterapkan.

## Prinsip

Pengguna tidak boleh bisa merusak reputasi domainnya sendiri melalui
antarmuka produk ini. Perlindungan yang bisa dimatikan bukan perlindungan.

Ini juga alasan komersialnya: klien membeli sistem yang tidak bisa membuat
mereka melanggar aturan tanpa disadari. Begitu tombol bypass ditambahkan,
pembeda itu hilang dan yang tersisa adalah versi lebih kecil dari layanan
yang sudah mapan dan lebih murah.

## Aturan yang tidak dapat dinonaktifkan

### 1. Identitas pengirim dan tautan berhenti berlangganan

Disisipkan pada tahap penyusunan pesan, di sisi server, bukan di editor.
Pengguna tidak dapat menghapusnya karena tidak pernah memegangnya.

Tautan berhenti berlangganan memakai token unik per penerima, dapat diakses
tanpa autentikasi, dan berlaku seketika — satu klik, tanpa halaman konfirmasi
bertingkat, tanpa perlu masuk akun.

Dasar: PP PSTE mewajibkan identitas pengirim yang jelas dan mekanisme berhenti
berlangganan yang mudah diakses serta berfungsi seketika.

### 2. Daftar penekanan permanen

Tidak ada operasi hapus di tingkat mana pun: tidak di UI, tidak di API, tidak
di ORM. Alamat masuk daftar melalui empat jalur:

| Jalur | Pemicu |
|---|---|
| Berhenti berlangganan | Penerima mengklik tautan |
| Pemantulan keras | Webhook SES |
| Keluhan spam | Webhook SES |
| Manual | Permintaan langsung, dicatat pelakunya |

Impor memeriksa daftar ini dan menolak alamat yang ada di dalamnya. Tidak ada
opsi menimpa.

### 3. Batas harian pemanasan domain

Domain baru tidak dapat langsung mengirim volume penuh. Jadwal bawaan:

| Tahap | Hari | Batas harian |
|---|---|---|
| 1 | 1–3 | 50 |
| 2 | 4–7 | 100 |
| 3 | 8–14 | 500 |
| 4 | 15–21 | 2.000 |
| 5 | 22+ | Sesuai kebutuhan |

Kenaikan tahap **tidak otomatis karena hari berganti**. `warmup-advance`
hanya menaikkan tahap kalau bounce dan keluhan berada dalam batas aman. Kalau
metrik memburuk, tahap ditahan atau diturunkan.

Ini penting: menaikkan volume saat metrik sedang buruk justru mempercepat
kerusakan.

### 4. Alamat hasil tebakan masuk karantina

Kontak dengan `email_origin = guessed` berstatus karantina sampai lolos
verifikasi alamat, dan dikecualikan dari kampanye pertama pada domain
pengirim baru.

Alasan: alamat tebakan adalah penyebab utama pemantulan keras. Menggabungkan
domain baru yang belum punya reputasi dengan alamat yang belum tentu ada
adalah kombinasi paling merusak yang bisa dilakukan sistem ini.

### 5. Sumber izin wajib

Kontak tanpa `consent_source` tidak dapat masuk kampanye. Impor berhenti
kalau field ini kosong.

Untuk CSV milik pengguna, sistem meminta pernyataan eksplisit mengenai asal
daftar sebelum impor dilanjutkan. Pernyataan dicatat beserta identitas
pengguna dan waktu.

Perlu jelas soal fungsi pernyataan ini: **ini jejak audit, bukan pengalihan
tanggung jawab.** Klausul pengalihan tanggung jawab dalam perjanjian baku
belum tentu berlaku, dan pernyataan pengguna tidak menghapus kewajiban
penyedia. Fungsinya membuat pengguna berhenti sejenak pada saat keputusan
diambil, dan meninggalkan catatan bila di kemudian hari perlu ditelusuri.

## Kanal WhatsApp tidak termasuk

Sistem ini hanya mengirim email. Kolom `whatsapp` dan `phone` dari Contact
Harvester disimpan sebagai `reference_contact` — dapat dilihat tim sales,
tidak dapat dipakai mengirim.

Alasannya bukan teknis. WhatsApp mensyaratkan izin penerima sebelum pesan
pertama, dan kontak hasil pengumpulan otomatis tidak memenuhi syarat itu.
Konsekuensinya cepat: laporan penerima menurunkan quality rating, tier volume
diturunkan, hingga nomor dinonaktifkan dalam hitungan minggu.

Penggunaan yang sah untuk nomor tersebut adalah dihubungi manusia untuk
menanyakan penanggung jawab dan meminta izin. Percakapan itulah yang
menghasilkan dasar izin untuk kanal WhatsApp di produk terpisah.

Pembatasan ini dinyatakan eksplisit supaya tidak ada penambahan kanal di
kemudian hari yang memakai nomor ini tanpa dasar izin.

## Pemeriksaan pra-kirim

Endpoint `/campaigns/:id/preflight` menjalankan seluruh pemeriksaan dan
mengembalikan hasil per butir. Butir yang gagal memblokir pengiriman.

```json
{
  "dapat_dikirim": false,
  "pemeriksaan": [
    { "butir": "identitas_pengirim", "lolos": true },
    { "butir": "tautan_berhenti", "lolos": true },
    { "butir": "penekanan_dikeluarkan", "lolos": true, "jumlah": 12 },
    { "butir": "karantina_dikeluarkan", "lolos": true, "jumlah": 118 },
    { "butir": "batas_pemanasan", "lolos": false,
      "pesan": "450 penerima melebihi sisa kuota 313" }
  ]
}
```

Pemeriksaan dijalankan di server. Menampilkannya di UI saja tidak cukup —
antarmuka bisa dilewati, endpoint tidak.

## Catatan

Rujukan pada PP PSTE, UU PDP, dan kebijakan platform disusun sebagai dasar
perancangan, bukan opini hukum formal. Peninjauan oleh konsultan hukum
disarankan sebelum produk ditawarkan ke pihak ketiga.
