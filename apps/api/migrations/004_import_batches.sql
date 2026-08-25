CREATE TABLE import_batches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename       text NOT NULL,
  row_count      integer NOT NULL DEFAULT 0,
  accepted       integer NOT NULL DEFAULT 0,
  rejected       integer NOT NULL DEFAULT 0,
  quarantined    integer NOT NULL DEFAULT 0,
  duplicate      integer NOT NULL DEFAULT 0,
  consent_source consent_source NOT NULL,
  declared_by    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ON DELETE SET NULL, bukan CASCADE. Membatalkan batch menghapus kontaknya
-- lewat kode yang tahu harus menyisakan alamat yang sudah masuk daftar
-- penekanan. Penghapusan berantai di tingkat database akan melewati aturan itu.
ALTER TABLE contacts
  ADD CONSTRAINT contacts_batch_fk
  FOREIGN KEY (import_batch_id) REFERENCES import_batches(id)
  ON DELETE SET NULL;
