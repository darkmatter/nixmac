//! Git module: low-level subprocess wrappers and diff parsing.

pub mod changes_from_diff;
pub mod exec;

// Re-export the entire public surface of exec so callers keep using
// `crate::git::some_fn()` without change.
#[allow(unused_imports)]
pub use exec::{
    cache_status, checkout_files_at_commit, commit_all, commit_diff, create_evolution_backup,
    current_branch, delete_backup_branch, get_full_diff, get_nix_diff, get_ref_sha, init_repo,
    intent_add_untracked, is_repo, log, read_tags, restore_all, restore_from_branch_ref, stash,
    status, status_and_cache, tag_commit, CommitInfo,
};
