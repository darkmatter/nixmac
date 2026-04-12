CREATE TABLE IF NOT EXISTS commits (
    id INTEGER PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    tree_hash TEXT NOT NULL,
    message TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS evolutions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    origin_branch TEXT NOT NULL,
    merged INTEGER NOT NULL DEFAULT 0,
    builds INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS change_summaries (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED', 'DONE', 'FAILED', 'CANCELLED')),
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS changes (
    id INTEGER PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    diff TEXT NOT NULL,
    line_count INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    own_summary_id INTEGER REFERENCES change_summaries(id)
);

CREATE TABLE IF NOT EXISTS group_summaries (
    change_id INTEGER NOT NULL REFERENCES changes(id),
    change_summary_id INTEGER NOT NULL REFERENCES change_summaries(id)
);

CREATE TABLE IF NOT EXISTS change_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    commit_id INTEGER REFERENCES commits(id),
    base_commit_id INTEGER NOT NULL REFERENCES commits(id),
    commit_message TEXT,
    generated_commit_message TEXT,
    created_at INTEGER NOT NULL,
    evolution_id INTEGER REFERENCES evolutions(id)
);

CREATE TABLE IF NOT EXISTS set_changes (
    change_set_id INTEGER NOT NULL REFERENCES change_sets(id),
    change_id INTEGER NOT NULL REFERENCES changes(id),
    PRIMARY KEY (change_set_id, change_id)
);

CREATE TABLE IF NOT EXISTS queued_summaries (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED', 'DONE', 'FAILED', 'CANCELLED')),
    attempted_count INTEGER NOT NULL DEFAULT 0,
    prompt TEXT NOT NULL,
    model_response TEXT,
    group_summary_id INTEGER REFERENCES change_summaries(id),
    hash_own_summary_id_pairs TEXT,
    type TEXT NOT NULL CHECK(type IN ('NEW_SINGLE', 'NEW_GROUP', 'EVOLVED_GROUP'))
);

CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY,
    text TEXT NOT NULL,
    commit_id INTEGER REFERENCES commits(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commits_tree_hash ON commits(tree_hash);
CREATE INDEX IF NOT EXISTS idx_evolutions_origin_branch ON evolutions(origin_branch);
CREATE INDEX IF NOT EXISTS idx_prompts_commit ON prompts(commit_id);
CREATE INDEX IF NOT EXISTS idx_change_sets_commit ON change_sets(commit_id);
CREATE INDEX IF NOT EXISTS idx_change_sets_base ON change_sets(base_commit_id);
CREATE INDEX IF NOT EXISTS idx_set_changes_change ON set_changes(change_id);
CREATE INDEX IF NOT EXISTS idx_queued_summaries_status ON queued_summaries(status);
