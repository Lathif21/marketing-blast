-- Kampanye dan penerimanya.
--
-- `campaign_recipients` adalah tabel terbesar sistem ini dan sumber seluruh
-- angka funnel maupun reputasi. Setiap baris merekam satu pesan ke satu alamat
-- dalam satu kampanye — bukan status terkini kontak, melainkan apa yang
-- terjadi pada pengiriman itu.
--
-- Alamat penerima disalin ke barisnya (`email`), tidak hanya direferensikan
-- lewat `contact_id`. Kontak bisa dihapus karena permintaan penghapusan data,
-- sementara catatan bahwa sebuah pesan pernah memantul tetap dibutuhkan untuk
-- menghitung reputasi domain. Menggantungkan angka bounce pada baris yang bisa
-- hilang berarti reputasi ikut berubah setiap kali ada penghapusan.

CREATE TYPE campaign_status AS ENUM (
  'draf',        -- masih disunting, belum pernah diantrekan
  'terjadwal',   -- lolos preflight, menunggu waktu kirim
  'berjalan',    -- sebagian penerima sudah diproses
  'jeda',        -- dihentikan sementara oleh pengguna
  'selesai',
  'dibatalkan'
);

CREATE TYPE recipient_status AS ENUM (
  'queued',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained',
  'failed',
  'skipped'     -- tersuppress atau terkarantina saat giliran kirim tiba
);

CREATE TABLE campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  subject         text NOT NULL,
  body_text       text NOT NULL,
  body_html       text,
  sender_domain   text NOT NULL,
  status          campaign_status NOT NULL DEFAULT 'draf',
  segment_filter  jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at    timestamptz,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX campaigns_status_idx ON campaigns (status);

CREATE TABLE campaign_recipients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id    uuid REFERENCES contacts(id) ON DELETE SET NULL,
  -- Disalin, bukan hanya direferensikan. Lihat catatan di atas.
  email         citext NOT NULL,
  status        recipient_status NOT NULL DEFAULT 'queued',
  message_id    text,
  skip_reason   text,
  queued_at     timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  delivered_at  timestamptz,
  opened_at     timestamptz,
  clicked_at    timestamptz,
  bounced_at    timestamptz,
  complained_at timestamptz,
  last_error    text,

  -- Satu alamat hanya boleh sekali per kampanye. Tanpa ini, menjalankan ulang
  -- penyusunan antrean setelah kegagalan separuh jalan akan mengirim ganda ke
  -- penerima yang sudah diproses.
  UNIQUE (campaign_id, email)
);

CREATE INDEX cr_campaign_status_idx ON campaign_recipients (campaign_id, status);
CREATE INDEX cr_pickup_idx
  ON campaign_recipients (campaign_id, queued_at)
  WHERE status = 'queued';
-- Dipakai webhook SES untuk menautkan event ke barisnya.
CREATE INDEX cr_message_id_idx ON campaign_recipients (message_id)
  WHERE message_id IS NOT NULL;
-- Dipakai health-recalc untuk jendela 7 hari.
CREATE INDEX cr_sent_at_idx ON campaign_recipients (sent_at)
  WHERE sent_at IS NOT NULL;
