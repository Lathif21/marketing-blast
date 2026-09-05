-- Jejak aktivasi manual kontak karantina.
--
-- Mengaktifkan kontak adalah penilaian manusia, bukan hasil pemeriksaan: yang
-- melakukannya menyatakan bahwa alamat itu layak dikirimi padahal sistem belum
-- memverifikasinya. Penilaian semacam itu perlu meninggalkan catatan.
--
-- Yang paling perlu ditelusuri adalah aktivasi alamat `guessed`. Endpoint
-- menolaknya secara bawaan; kalau seseorang menempuh jalur pengecualian, kolom
-- di bawah menyimpan siapa dan kapan — sehingga saat pemantulan melonjak,
-- pertanyaan "dari mana alamat ini boleh dikirimi" punya jawaban.
--
-- Dua kolom, bukan tabel terpisah. Yang dibutuhkan hanyalah keadaan terkini
-- per kontak; riwayat lengkap aktivasi-nonaktivasi berulang bukan sesuatu yang
-- pernah ditanyakan.

ALTER TABLE contacts
  ADD COLUMN activated_at timestamptz,
  ADD COLUMN activated_by text;

-- Dipakai menelusuri "siapa mengaktifkan apa" saat metrik memburuk.
CREATE INDEX contacts_activated_idx ON contacts (activated_at)
  WHERE activated_at IS NOT NULL;
