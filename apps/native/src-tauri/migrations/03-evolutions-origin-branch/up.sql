-- Legacy databases created before rusqlite_migration used `evolutions.branch`.
-- The Rust hook for this migration performs the conditional column repair.
SELECT 1;
