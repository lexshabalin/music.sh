-- Jobs progress/result tracking (for imprint, long tasks, etc.)
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS progress_total INT,
  ADD COLUMN IF NOT EXISTS progress_done INT,
  ADD COLUMN IF NOT EXISTS progress_msg TEXT,
  ADD COLUMN IF NOT EXISTS result JSONB;

