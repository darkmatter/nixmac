//! Git module: low-level subprocess wrappers and diff parsing.

pub mod changes_from_diff;
pub mod exec;
pub mod query;

// Re-export the entire public surface of exec and query so callers keep using
// `crate::git::some_fn()` without change.
#[allow(unused_imports)]
pub use exec::{
    cache_status, checkout_files_at_commit, commit_all, commit_diff, create_evolution_backup,
    delete_backup_branch, get_full_diff, get_nix_diff, init_repo, intent_add_untracked, log,
    restore_all, restore_from_branch_ref, stash, status, status_and_cache, tag_commit, CommitInfo,
};

#[allow(unused_imports)]
pub use query::{current_branch, get_ref_sha, is_repo, read_tags};
