-- Kesehatan domain pengirim dan penghitung kuota harian.
--
-- Satu baris per domain pengirim. Tabel ini adalah satu-satunya sumber
-- kebenaran untuk "berapa yang boleh dikirim hari ini" — pemeriksaan pra-kirim
-- dan worker membaca angka yang sama, supaya tidak ada celah antara apa yang
-- ditampilkan dan apa yang ditegakkan.
--
-- `warmup_stage` sengaja tidak punya kolom tanggal kenaikan otomatis. Kenaikan
-- hanya dilakukan `warmup-advance` setelah memeriksa metrik, bukan karena hari
-- berganti (04-aturan-kepatuhan.md §3).

CREATE TABLE domain_health (
  domain              text PRIMARY KEY,
  warmup_stage        integer NOT NULL DEFAULT 1,
  warmup_started_on   date NOT NULL DEFAULT CURRENT_DATE,
  stage_entered_on    date NOT NULL DEFAULT CURRENT_DATE,
  bounce_rate_7d      numeric(5,2),
  complaint_rate_7d   numeric(5,2),
  metrics_updated_at  timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT warmup_stage_valid CHECK (warmup_stage BETWEEN 1 AND 5)
);

-- Penghitung terpisah per hari, bukan kolom `sent_today` yang di-reset.
--
-- Kolom yang di-reset menyimpan satu angka dan kehilangan riwayatnya; kalau
-- proses reset gagal atau terlambat, kuota kemarin terbawa ke hari ini tanpa
-- jejak. Baris per hari membuat kegagalan itu terlihat, sekaligus memberi data
-- untuk grafik volume harian tanpa memindai tabel penerima.
CREATE TABLE domain_daily_sends (
  domain     text NOT NULL,
  send_date  date NOT NULL,
  sent_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (domain, send_date)
);

CREATE INDEX dds_date_idx ON domain_daily_sends (send_date);
