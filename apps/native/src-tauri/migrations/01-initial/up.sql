-- Content-addressed summary schema.
--
-- Summaries describe *what a patch does*, keyed only by the content hash of the
-- change(s) they cover. Git remains the source of truth for diffs; these tables
-- are a local cache that can always be rebuilt by re-summarizing.

-- Per-change summary. Used for singletons / fallback (a change the model
-- described on its own, or a one-member group).
CREATE TABLE IF NOT EXISTS patch_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    change_hash TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'DONE' CHECK(status IN ('QUEUED', 'DONE', 'FAILED', 'CANCELLED')),
    created_at INTEGER NOT NULL
);

-- First-class group summary. `group_key` content-addresses the exact set of
-- member change hashes (sha256 of the sorted hashes), so a group's identity is
-- its membership.
CREATE TABLE IF NOT EXISTS summary_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'DONE' CHECK(status IN ('QUEUED', 'DONE', 'FAILED', 'CANCELLED')),
    created_at INTEGER NOT NULL
);

-- Membership of a group. Content-addressed by `group_key`.
CREATE TABLE IF NOT EXISTS summary_group_members (
    group_key TEXT NOT NULL REFERENCES summary_groups(group_key),
    change_hash TEXT NOT NULL,
    PRIMARY KEY (group_key, change_hash)
);

-- Thin evolution record — just the origin branch an evolution started from.
CREATE TABLE IF NOT EXISTS evolutions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin_branch TEXT NOT NULL
);

-- A snapshot caches the generated commit message for an exact set of change
-- hashes. `snapshot_key` = sha256(sorted change hashes). The integer `id` is the
-- value historically plumbed as `changeset_id` throughout evolve/build state.
CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_key TEXT NOT NULL UNIQUE,
    generated_commit_message TEXT,
    evolution_id INTEGER REFERENCES evolutions(id),
    created_at INTEGER NOT NULL
);

-- Records which commits were created by a restore operation and their origin.
CREATE TABLE IF NOT EXISTS restore_commits (
    commit_hash TEXT PRIMARY KEY,
    origin_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evolutions_origin_branch ON evolutions(origin_branch);
CREATE INDEX IF NOT EXISTS idx_summary_group_members_hash ON summary_group_members(change_hash);
