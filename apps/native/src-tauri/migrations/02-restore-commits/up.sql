CREATE TABLE IF NOT EXISTS restore_commits (
    commit_hash TEXT PRIMARY KEY,
    origin_hash TEXT NOT NULL
);
