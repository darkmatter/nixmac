-- nixmac_builds: metadata sidecar for nixmac-initiated builds.
CREATE TABLE IF NOT EXISTS nixmac_builds (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    changeset_id INTEGER REFERENCES change_sets(id),
    built_at     INTEGER NOT NULL
);

-- darwin_builds: tracking darwin builds, nixmac initiated or picked up by watcher as the latest build
-- may be less complete than --list-generations
CREATE TABLE IF NOT EXISTS darwin_builds (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nix_generation  INTEGER NOT NULL,
    store_path      TEXT    NOT NULL,
    nixmac_build_id INTEGER REFERENCES nixmac_builds(id),
    detected_at     INTEGER NOT NULL,
    UNIQUE(nix_generation, store_path)
);

CREATE INDEX IF NOT EXISTS idx_darwin_builds_detected_at ON darwin_builds(detected_at DESC);

-- Records the darwin_builds row that was active at the time of each commit.
CREATE TABLE IF NOT EXISTS build_commits (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    commit_id       INTEGER NOT NULL REFERENCES commits(id),
    darwin_build_id INTEGER NOT NULL REFERENCES darwin_builds(id),
    created_at      INTEGER NOT NULL
);
