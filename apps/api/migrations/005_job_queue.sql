CREATE TYPE job_status AS ENUM ('pending', 'running', 'done', 'failed');

CREATE TABLE job_queue (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type     text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       job_status NOT NULL DEFAULT 'pending',
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Pengambilan pekerjaan memakai FOR UPDATE SKIP LOCKED, jadi indeks parsial
-- ini yang dipakai saat mencari kandidat.
CREATE INDEX job_queue_pickup_idx
  ON job_queue (status, scheduled_at)
  WHERE status = 'pending';
