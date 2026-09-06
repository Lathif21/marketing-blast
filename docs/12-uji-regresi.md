# 12 — Menjalankan Uji Regresi

Panduan menjalankan uji otomatis produk ini: apa yang dibuktikan, cara
menjalankannya, dan cara membaca hasilnya saat gagal.

Ada dua lapis, dan keduanya perlu:

| | Perintah | Butuh basis data | Waktu |
|---|---|---|---|
| **Uji unit** | `npm test` | Tidak | Beberapa detik |
| **Uji regresi (end-to-end)** | `npm run test:e2e` | Ya | ~1 menit |

Uji unit menguji aturan yang dapat dinilai sendirian — penguraian CSV,
dekripsi berkas `.enc`, penyusunan segmen, penilaian respons, analisis
korespondensi Gmail. Uji regresi menguji yang **tidak dapat dibuktikan tanpa
PostgreSQL sungguhan**: transaksi, kuota, Row Level Security, hak peran, dan
seluruh alur kirim dari antrean sampai daftar penekanan.

---

## Menjalankan

Seluruh perintah dijalankan dari `apps/api`. Shell bawaan di mesin ini
PowerShell, yang **tidak menerima `&&`** sebagai pemisah perintah — pakai `;`
atau jalankan baris terpisah.

### 1. Nyalakan basis data

```powershell
cd "d:\Lathif Personal\marketing-blast"
docker compose up -d db
```

Kalau gagal dengan `open //./pipe/dockerDesktopLinuxEngine`, Docker Desktop
belum berjalan. Buka aplikasinya, tunggu sampai ikonnya berhenti berputar,
lalu ulangi.

### 2. Jalankan uji unit lebih dulu

```powershell
cd apps\api
npm run check
```

`check` menjalankan `tsc` lalu seluruh uji unit. Kalau ini merah, tidak perlu
melanjutkan ke uji regresi — yang gagal di sini akan gagal juga di sana, hanya
dengan pesan yang lebih sulit dibaca.

### 3. Jalankan uji regresi

```powershell
npm run test:e2e
```

Perintah ini membangun ulang TypeScript lebih dulu, jadi tidak perlu `tsc`
terpisah.

Keluarannya berupa daftar per butir, dikelompokkan per bagian:

```
── Isolasi pelanggan — ditegakkan basis data, bukan query ──
ok     pelanggan hanya melihat kontaknya sendiri — 4 terlihat
ok     query tanpa penyaring pun tidak menembus pelanggan lain — 0 baris
...

128/128 lulus
```

Keluar dengan kode `0` bila semua lulus, `1` bila ada yang gagal — jadi dapat
dipakai di CI apa adanya.

---

## Pengaman: basis data terpisah

**Uji regresi menjalankan `DELETE FROM contacts` untuk membersihkan fixture.**

Karena itu ia TIDAK PERNAH berjalan pada basis data pengembangan. Sebelum apa
pun dijalankan, `regression-setup.ts` menyalakan basis data terpisah
berakhiran `_regresi` — membuatnya bila belum ada — lalu menjalankan ulang
dirinya sebagai proses anak yang menunjuk ke sana:

```
marketing_blast           ← data pengembangan Anda, TIDAK PERNAH disentuh
marketing_blast_regresi   ← dibuat dan dibersihkan uji
```

`regression-guard.ts` memeriksanya lagi setiap kali fixture dibersihkan, bukan
sekali di awal. Kalau nama basis datanya tidak berakhiran `_regresi`, prosesnya
berhenti.

Pengaman ini ada karena kejadiannya sudah pernah terjadi: satu kali menjalankan
uji menghapus seluruh kontak hasil impor. Peringatan di komentar tidak
mencegahnya — yang mencegahnya adalah tidak pernah menunjuk ke sana.

## Pengaman: driver email

Uji ini mengirim ribuan pesan ke alamat karangan. Kalau `MAIL_DRIVER` bukan
`dummy`, prosesnya **berhenti sebelum satu pun uji berjalan**:

```
BERHENTI: MAIL_DRIVER bukan `dummy`. Uji ini mengirim ribuan pesan
ke alamat karangan — menjalankannya dengan driver sungguhan akan
merusak reputasi domain.
```

Kalau Anda sedang menguji SES sungguhan, kembalikan `MAIL_DRIVER=dummy` di
`.env` sebelum menjalankan uji.

---

## Yang dibuktikan

128 pemeriksaan, dikelompokkan menjadi 15 bagian.

| Bagian | Butir | Yang dibuktikan |
|---|---|---|
| Pembekuan, sesi, dan kata sandi | 20 | scrypt, sesi tercabut seketika saat pelanggan dibekukan, pra-kirim memblokirnya, kuota kontak |
| Aktivasi manual | 17 | Tiga penolakan: diblokir, tersuppress, alamat tebakan |
| Integrasi Gmail | 14 | Balasan tertaut, korespondensi dua arah masuk, satu arah dan buletin ditolak, idempoten |
| Tindak lanjut | 11 | Hanya yang bereaksi terdaftar, jeda ditegakkan, kampanye bergulir tidak ditutup |
| Isolasi pelanggan | 11 | Query **tanpa penyaring** pun tidak menembus pelanggan lain |
| send-worker (3 bagian) | 16 | Berhenti tepat di kuota, sisanya tetap `queued`, penekanan tersaring saat kirim |
| Memilih penerima | 7 | `contact_ids` menyaring tepat, daftar kosong bukan "kirim ke semua" |
| Berhenti berlangganan | 7 | Tetap bekerja setelah kontaknya dihapus |
| Preflight | 6 | Volume di atas kuota diblokir, `tanggal_muat` benar |
| Penilaian respons | 6 | Yang diam berhenti dikirimi, penolakan mengalahkan reaksi |
| Hak peran aplikasi | 5 | `DELETE` pada `suppression` tetap ditolak database |
| Kuota dan kesehatan domain | 8 | Satu sumber angka untuk pra-kirim dan worker |

### Yang TIDAK dibuktikan

Penting diketahui supaya "128/128 lulus" tidak dibaca lebih luas dari
seharusnya:

- **Pengiriman SES sungguhan.** Seluruh uji memakai driver `dummy`. Jalur SES
  belum pernah berjalan sungguhan — lihat [08-amazon-ses.md](08-amazon-ses.md)
  bagian 10.
- **Alur OAuth Gmail sungguhan.** Yang diuji adalah penilaian korespondensi dan
  penyimpanannya, memakai klien tiruan. Penukaran kode dengan Google belum
  pernah dijalankan terhadap akun sungguhan.
- **Antarmuka.** Tidak ada uji peramban sama sekali. Layar diperiksa manual.
- **Dua worker yang saling menyela.** Kuota habis di tengah batch karena proses
  LAIN ikut mengirim tidak dapat dipicu secara deterministik dari satu proses
  uji. Yang melindungi dari itu adalah SAVEPOINT per penerima di
  `send-worker.ts` — perlindungan yang ada di kode, bukan yang dibuktikan uji.

---

## Saat gagal

Butir yang gagal ditandai `GAGAL` beserta nilai yang benar-benar didapat:

```
GAGAL  balasan kampanye tercatat — 0
```

Angka di belakang tanda pisah adalah nilai sesungguhnya. Itu biasanya sudah
cukup menunjuk penyebabnya.

### Kegagalan yang sering muncul dan artinya

**`Variabel lingkungan DATABASE_URL wajib diisi`**
`.env` tidak terbaca. Perintahnya memakai `--env-file=../../.env`, jadi harus
dijalankan dari `apps/api`, bukan dari akar repo.

**`role "blast_app" does not exist` atau galat hak akses**
Migrasi belum dijalankan pada basis data uji. Uji membuat basis datanya
sendiri, tapi migrasinya dijalankan runner yang sama — jalankan
`npm run migrate:local` lebih dulu bila baru menambah migrasi.

**`null value in column "tenant_id" violates not-null constraint`**
Fixture disisipkan lewat koneksi PEMILIK, yang melewati RLS dan karena itu
tidak mendapat `tenant_id` dari `DEFAULT app_tenant()`. Setiap `INSERT` fixture
harus menyebutkan `tenant_id` sendiri.

**`there is no unique or exclusion constraint matching the ON CONFLICT`**
Sasaran `ON CONFLICT` tidak lagi cocok dengan indeks unik yang berlaku. Sejak
multi-tenant, keunikan `contacts` dan `suppression` menjadi `(tenant_id,
email)` — bukan `email` saja.

**`Query data pelanggan dijalankan tanpa konteks tenant`**
Kode yang menyentuh data pelanggan dipanggil di luar `dalamKonteks()`. Di uji,
bungkus bagiannya dengan `sebagaiTenant(...)`.

### Menjalankan ulang dari bersih

Basis data uji dapat dibuang kapan saja — ia dibuat ulang otomatis:

```powershell
docker compose exec db psql -U blast -d postgres -c "DROP DATABASE marketing_blast_regresi;"
npm run test:e2e
```

---

## Menambah uji baru

Seluruh uji regresi ada di satu berkas,
[`apps/api/src/scripts/regression.ts`](../apps/api/src/scripts/regression.ts).
Satu berkas dengan sengaja: yang dijaga uji ini adalah alur yang saling
bersinggungan, dan memecahnya menjadi banyak berkas membuat fixture bersama
sulit ditelusuri.

Bentuk satu bagian:

```ts
async function ujiSesuatu() {
  bagian("Judul bagian — apa yang dibuktikan");

  await bersihkan();          // fixture bersih, tenant TIDAK dihapus
  await setTahap(5);          // tahap pemanasan; 5 = tanpa batas harian
  await buatKontak(3, "x");   // 3 kontak aktif berawalan x0@, x1@, x2@

  const c = await buatKampanye("Nama kampanye");
  await kampanye.susunAntrean(c.id);
  await runSendWorker();

  ok("kalimat yang menyatakan harapannya", nilai === harapan, `${nilai}`);
}
```

Lalu daftarkan di `main()`:

```ts
await sebagaiTenant(ujiSesuatu);
```

`sebagaiTenant` membungkusnya dengan konteks pelanggan uji. Bagian yang justru
menguji perilaku LINTAS pelanggan — seperti `ujiIsolasiTenant` — mengatur
konteksnya sendiri dan tidak dibungkus.

Dua kebiasaan yang membuat uji ini tetap berguna:

1. **Kalimat `ok(...)` menyatakan yang dijaga, bukan yang dilakukan.** "sisanya
   tetap queued, bukan failed" memberi tahu pembaca berikutnya kenapa uji itu
   ada; "cek status" tidak.
2. **Sertakan nilai sesungguhnya sebagai argumen ketiga.** Saat gagal, itulah
   yang membedakan lima menit penelusuran dari satu jam.
