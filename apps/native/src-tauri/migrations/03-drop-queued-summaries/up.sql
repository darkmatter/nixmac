-- The queued_summaries table backed the per-hunk summarization queue worker
-- that PR #330 deleted. Nothing reads or writes the table anymore, so drop it
-- and its status index to keep fresh databases lean.
DROP INDEX IF EXISTS idx_queued_summaries_status;
DROP TABLE IF EXISTS queued_summaries;
