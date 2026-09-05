-- Kampanye lanjutan dan penilaian respons kontak.
--
-- Kampanye pertama adalah perkenalan. Setelah terkirim, penerima terbelah dua
-- dan keduanya butuh perlakuan berbeda:
--
--   * yang menolak atau diam — tidak dikirimi lagi, dan pada akhirnya dihapus
--   * yang membuka, mengklik, atau membalas — dikirimi langkah berikutnya
--
-- Yang dicatat di sini adalah PENILAIAN atas kelompok itu, bukan eventnya.
-- Eventnya sudah ada di `campaign_recipients` (opened_at, clicked_at, dan
-- sekarang replied_at). Penilaian disimpan terpisah di `contacts` karena yang
-- dipakai menyusun segmen adalah keadaan terkini kontak, bukan riwayat per
-- pesan — dan menurunkannya berulang kali saat menyusun antrean berarti query
-- pemilihan penerima ikut menanggung biaya agregasi seluruh riwayat.

-- ── Balasan ──────────────────────────────────────────────────────────────────
--
-- Balasan adalah sinyal ketertarikan terkuat yang bisa diterima sistem ini:
-- membuka email bisa tidak sengaja, membalas tidak.
--
-- `reply_snippet` sengaja hanya potongan, bukan isi utuh. Yang dibutuhkan
-- adalah bukti bahwa balasan itu ada dan sekilas nadanya; menyimpan seluruh
-- isi balasan berarti sistem pemasaran ini menampung korespondensi pribadi
-- yang tidak pernah diminta pengguna untuk disimpan.
ALTER TABLE campaign_recipients
  ADD COLUMN replied_at    timestamptz,
  ADD COLUMN reply_snippet text;

CREATE INDEX cr_replied_idx ON campaign_recipients (campaign_id, replied_at)
  WHERE replied_at IS NOT NULL;

-- Dipakai penilaian respons untuk menemukan baris "pernah bereaksi" tanpa
-- memindai seluruh tabel penerima.
CREATE INDEX cr_engaged_idx ON campaign_recipients (contact_id)
  WHERE opened_at IS NOT NULL OR clicked_at IS NOT NULL OR replied_at IS NOT NULL;

-- ── Penilaian respons per kontak ─────────────────────────────────────────────

CREATE TYPE respons_kontak AS ENUM (
  'belum_ada',   -- belum pernah dikirimi apa pun
  'menunggu',    -- sudah dikirimi, jendela penilaian belum habis
  'tertarik',    -- membuka, mengklik, atau membalas
  'menolak',     -- keluhan spam atau berhenti berlangganan
  'diam'         -- jendela penilaian habis tanpa satu pun reaksi
);

ALTER TABLE contacts
  ADD COLUMN respons              respons_kontak NOT NULL DEFAULT 'belum_ada',
  ADD COLUMN last_sent_at         timestamptz,
  ADD COLUMN last_engaged_at      timestamptz,
  -- Kapan penilaian terakhir dijalankan. Bukan hiasan: tanpa ini tidak ada
  -- cara membedakan "dinilai diam kemarin" dari "belum pernah dinilai sama
  -- sekali karena job-nya mati seminggu".
  ADD COLUMN respons_dinilai_pada timestamptz;

-- Segmen kampanye lanjutan menyaring atas kolom ini, jadi ia harus terindeks
-- sebagaimana `status`.
CREATE INDEX contacts_respons_idx ON contacts (respons);
CREATE INDEX contacts_diam_idx ON contacts (last_sent_at)
  WHERE respons = 'diam';

-- ── Kampanye lanjutan ────────────────────────────────────────────────────────

CREATE TYPE pemicu_lanjutan AS ENUM (
  'membalas',  -- paling sempit, paling kuat
  'diklik',
  'dibuka',
  'apa_saja'   -- membuka ATAU mengklik ATAU membalas
);

ALTER TABLE campaigns
  -- ON DELETE SET NULL, bukan CASCADE: menghapus kampanye perkenalan tidak
  -- boleh ikut menghapus kampanye lanjutan yang isinya ditulis terpisah dan
  -- mungkin sudah terkirim ke sebagian orang.
  ADD COLUMN parent_campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  ADD COLUMN pemicu             pemicu_lanjutan,
  -- Jeda sebelum lanjutan boleh dikirim, dihitung dari saat reaksi terjadi.
  -- Membalas lalu menerima email otomatis dalam hitungan detik terbaca sebagai
  -- robot, dan itu justru memicu keluhan yang seluruh produk ini hindari.
  ADD COLUMN jeda_lanjutan_jam  integer NOT NULL DEFAULT 24
    CONSTRAINT jeda_lanjutan_wajar CHECK (jeda_lanjutan_jam BETWEEN 0 AND 24 * 90),
  -- Pendaftaran bergulir. Selama `true`, penerima baru yang memenuhi pemicu
  -- ikut ditambahkan tiap kali worker berjalan — bukan hanya yang sudah
  -- bereaksi saat kampanye lanjutan dibuat.
  ADD COLUMN lanjutan_aktif     boolean NOT NULL DEFAULT false,

  -- Sebuah kampanye tidak boleh menjadi lanjutan dari dirinya sendiri:
  -- pemicunya akan terpenuhi oleh pengirimannya sendiri dan berulang selamanya.
  ADD CONSTRAINT lanjutan_bukan_diri_sendiri
    CHECK (parent_campaign_id IS NULL OR parent_campaign_id <> id),

  -- Pemicu tanpa induk tidak berarti apa-apa, dan induk tanpa pemicu membuat
  -- worker harus menebak. Keduanya ada, atau keduanya tidak.
  ADD CONSTRAINT lanjutan_lengkap
    CHECK ((parent_campaign_id IS NULL) = (pemicu IS NULL));

CREATE INDEX campaigns_parent_idx ON campaigns (parent_campaign_id)
  WHERE parent_campaign_id IS NOT NULL;
