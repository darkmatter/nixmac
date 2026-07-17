//! Git auto-update has a lot of purpose-built logic for nixmac, so it lives in its own module.
//! It is not intended to be a part of the more general-purpose git library, although some
//! of the helper methods in here may be appropriate to migrate to query.rs if they are needed,
//! for example `upstream_for_current_branch` and `remote_name_for_current_branch`.
//!

use anyhow::{Context, Result};
use git2::{AutotagOption, BranchType, MergeAnalysis, Repository};

use crate::git::auth::authenticated_fetch_options;
use crate::git::init::require_repo;
use crate::git::query::{current_branch, head_oid};

/// Relative position of the checked-out branch and its upstream tracking branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BranchSyncState {
    UpToDate,
    Behind,
    Ahead,
    Diverged,
}

/// Snapshot of the local/upstream state used to decide whether auto-update is safe.
/// Includes additional information to facilitate the update if it is safe to proceed.
#[derive(Debug)]
pub struct AutoUpdateGitStatus {
    pub branch: String,
    /// Included in the decision now so the later update/rebuild flow can report
    /// exactly which upstream ref it is applying.
    pub upstream_name: String,
    pub local_oid: git2::Oid,
    pub upstream_oid: git2::Oid,
    pub state: BranchSyncState,
}

/// Action the auto-update flow should take after inspecting Git state.
#[derive(Debug)]
#[allow(dead_code)]
pub enum AutoUpdateDecision {
    Noop(String),
    UpdateAndRebuild {
        local_oid: git2::Oid,
        upstream_oid: git2::Oid,
        /// Plan is to use this for user-facing progress and logs.
        upstream_name: String,
    },
    WarnAndSkip(String),
}

/// User/configuration guardrails that constrain when auto-update may run.
#[allow(dead_code)]
pub struct AutoUpdateConfig {
    pub enabled: bool,
    pub repo_path: std::path::PathBuf,
    pub branch: Option<String>,
    pub remote: Option<String>,
    pub require_clean_worktree: bool,
    pub block_untracked_files: bool,
}

/// Fast-forwards the current local branch to an already-fetched upstream commit.
///
/// TODO: This is not hooked up yet but will be the next step in implementing the actual update
/// after the check decision is made.
#[allow(dead_code)]
pub fn fast_forward_to_upstream(repo: &Repository, upstream_oid: git2::Oid) -> Result<()> {
    let branch_name = current_branch(repo).context("repository is in detached HEAD state")?;

    let annotated = repo
        .find_annotated_commit(upstream_oid)
        .context("failed to find upstream annotated commit")?;

    let (analysis, _preference) = repo
        .merge_analysis(&[&annotated])
        .context("failed to analyze merge")?;

    if analysis.contains(MergeAnalysis::ANALYSIS_UP_TO_DATE) {
        return Ok(());
    }

    if !analysis.contains(MergeAnalysis::ANALYSIS_FASTFORWARD) {
        anyhow::bail!("upstream update is not a fast-forward");
    }

    let refname = format!("refs/heads/{branch_name}");

    let mut reference = repo
        .find_reference(&refname)
        .with_context(|| format!("failed to find local branch ref {refname}"))?;

    reference
        .set_target(
            upstream_oid,
            &format!("nixmac auto-update: fast-forward to {upstream_oid}"),
        )
        .context("failed to update local branch ref")?;

    repo.set_head(&refname)
        .with_context(|| format!("failed to set HEAD to {refname}"))?;

    let mut checkout_builder = git2::build::CheckoutBuilder::new();

    checkout_builder
        .safe()
        .recreate_missing(true)
        .remove_untracked(false);

    repo.checkout_head(Some(&mut checkout_builder))
        .context("failed to check out updated HEAD")?;

    Ok(())
}

/// Converts an inspected branch state into the high-level auto-update action.
fn decide_auto_update(status: &AutoUpdateGitStatus) -> AutoUpdateDecision {
    match status.state {
        BranchSyncState::UpToDate => AutoUpdateDecision::Noop(format!(
            "Branch {} is already up to date with {}.",
            status.branch, status.upstream_name
        )),

        BranchSyncState::Behind => AutoUpdateDecision::UpdateAndRebuild {
            local_oid: status.local_oid,
            upstream_oid: status.upstream_oid,
            upstream_name: status.upstream_name.clone(),
        },

        BranchSyncState::Ahead => AutoUpdateDecision::WarnAndSkip(format!(
            "Local branch {} is ahead of {}. Skipping automatic update.",
            status.branch, status.upstream_name
        )),

        BranchSyncState::Diverged => AutoUpdateDecision::WarnAndSkip(format!(
            "Local branch {} has diverged from {}. Skipping automatic update.",
            status.branch, status.upstream_name
        )),
    }
}

/// For auto-update, we have strict requirements for the working tree to be clean, including:
/// 1. No uncommitted changes in tracked files.
/// 2. No untracked files or directories (ignored files are not considered).
fn is_worktree_clean_for_auto_update(dir: &str) -> anyhow::Result<bool> {
    crate::git::init::require_repo(dir)?;

    let repo = git2::Repository::discover(dir)?;

    let head_tree = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .and_then(|c| c.tree().ok());

    let mut opts = git2::DiffOptions::new();

    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false)
        .include_unmodified(false);

    let diff = repo.diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut opts))?;

    Ok(diff.deltas().len() == 0)
}

/// Get the upstream tracking branch for the current branch, and its OID.
fn upstream_for_current_branch(repo: &Repository) -> Result<(String, git2::Oid)> {
    let branch_name = current_branch(repo).context("repository is in detached HEAD state")?;

    let local_branch = repo
        .find_branch(&branch_name, BranchType::Local)
        .with_context(|| format!("failed to find local branch {branch_name}"))?;

    let upstream = local_branch
        .upstream()
        .with_context(|| format!("branch {branch_name} has no upstream tracking branch"))?;

    let upstream_name = upstream
        .name()?
        .context("upstream branch name is not valid UTF-8")?
        .to_string();

    let upstream_oid = upstream
        .get()
        .target()
        .context("upstream branch does not point to a commit")?;

    Ok((upstream_name, upstream_oid))
}

/// Returns the configured remote name for the current branch's upstream.
fn remote_name_for_current_branch(repo: &Repository) -> Result<String> {
    let branch_name = current_branch(repo).context("repository is in detached HEAD state")?;

    let local_branch = repo
        .find_branch(&branch_name, BranchType::Local)
        .with_context(|| format!("failed to find local branch {branch_name}"))?;

    let upstream_ref = local_branch
        .upstream()
        .with_context(|| format!("branch {branch_name} has no upstream tracking branch"))?;

    let upstream_ref_name = upstream_ref
        .get()
        .name()
        .context("upstream ref has no name")?;

    // Usually refs/remotes/origin/main
    let Some(stripped) = upstream_ref_name.strip_prefix("refs/remotes/") else {
        anyhow::bail!("upstream ref is not a remote-tracking ref: {upstream_ref_name}");
    };

    let Some((remote_name, _remote_branch)) = stripped.split_once('/') else {
        anyhow::bail!("could not parse remote name from upstream ref: {upstream_ref_name}");
    };

    Ok(remote_name.to_string())
}

/// Fetches the already-resolved upstream remote for the current branch.
fn fetch_upstream(repo: &Repository, remote_name: &str) -> Result<()> {
    let mut fetch_options = authenticated_fetch_options(None);
    fetch_options.download_tags(AutotagOption::Unspecified);

    let mut remote = repo
        .find_remote(remote_name)
        .with_context(|| format!("failed to find remote {remote_name}"))?;

    // Empty refspecs means use the remote's configured fetch refspecs.
    remote
        .fetch(&[] as &[&str], Some(&mut fetch_options), None)
        .with_context(|| format!("failed to fetch remote {remote_name}"))?;

    Ok(())
}

/// Classify the relationship between the current branch and its upstream tracking branch.
fn classify_branch_state(
    repo: &Repository,
    local_oid: git2::Oid,
    upstream_oid: git2::Oid,
) -> Result<BranchSyncState> {
    if local_oid == upstream_oid {
        return Ok(BranchSyncState::UpToDate);
    }

    let base_oid = repo
        .merge_base(local_oid, upstream_oid)
        .context("failed to find merge-base between local HEAD and upstream")?;

    if base_oid == local_oid {
        Ok(BranchSyncState::Behind)
    } else if base_oid == upstream_oid {
        Ok(BranchSyncState::Ahead)
    } else {
        Ok(BranchSyncState::Diverged)
    }
}

/// Builds the auto-update status snapshot after refs have been fetched.
fn inspect_git_status(repo: &Repository) -> Result<AutoUpdateGitStatus> {
    let branch = current_branch(repo).context("repository is in detached HEAD state")?;
    let local_oid = head_oid(repo)?;

    let (upstream_name, upstream_oid) = upstream_for_current_branch(repo)?;

    let state = classify_branch_state(repo, local_oid, upstream_oid)?;

    Ok(AutoUpdateGitStatus {
        branch,
        upstream_name,
        local_oid,
        upstream_oid,
        state,
    })
}

/// Main entry point for checking whether an auto-update is possible.
///
/// This is the guts of the "checking" portion of this module.
pub fn check_auto_update(config_dir: &str) -> Result<AutoUpdateDecision> {
    require_repo(config_dir)?;
    let repo = Repository::discover(config_dir)?;

    log::debug!(
        "[git::auto_update] checking auto-update for repo at {}",
        config_dir
    );

    // 1. Auto-update only runs from a clean worktree.
    match is_worktree_clean_for_auto_update(config_dir) {
        Ok(true) => {}
        Ok(false) => {
            log::warn!("[git::auto_update] Skipping auto-update: worktree is not clean");
            return Ok(AutoUpdateDecision::WarnAndSkip(
                "Worktree is not clean.".to_string(),
            ));
        }
        Err(err) => {
            log::warn!("[git::auto_update] Skipping auto-update: {err}");
            return Ok(AutoUpdateDecision::WarnAndSkip(format!(
                "Failed to check worktree cleanliness: {err}"
            )));
        }
    }

    // 2. Require HEAD to be attached to a local branch.
    if current_branch(&repo).is_none() {
        log::warn!("[git::auto_update] Skipping auto-update: repository is in detached HEAD state");
        return Ok(AutoUpdateDecision::WarnAndSkip(
            "Repository is in detached HEAD state.".to_string(),
        ));
    }

    // 3. Resolve the remote backing the branch's upstream tracking ref.
    let remote_name = match remote_name_for_current_branch(&repo) {
        Ok(remote_name) => remote_name,
        Err(err) => {
            log::warn!(
                "[git::auto_update] Skipping auto-update: failed to get upstream remote: {err}"
            );
            return Ok(AutoUpdateDecision::WarnAndSkip(format!(
                "Failed to get upstream remote: {err}"
            )));
        }
    };

    // 4. Fetch the current branch's configured upstream remote.
    if let Err(err) = fetch_upstream(&repo, &remote_name) {
        log::warn!("[git::auto_update] Skipping auto-update: failed to fetch upstream: {err}");
        return Ok(AutoUpdateDecision::WarnAndSkip(format!(
            "Failed to fetch upstream: {err}"
        )));
    }

    // 5. Compare local HEAD with the freshly fetched upstream ref.
    let status = match inspect_git_status(&repo) {
        Ok(status) => status,
        Err(err) => {
            log::warn!(
                "[git::auto_update] Skipping auto-update: failed to inspect Git state: {err}"
            );
            return Ok(AutoUpdateDecision::WarnAndSkip(format!(
                "Failed to inspect Git state: {err}"
            )));
        }
    };

    // 6. Convert the sync state into the action the caller should take.
    Ok(decide_auto_update(&status))
}

#[cfg(test)]
mod tests {
    use crate::git::init::init_repo;

    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    fn make_initial_commit(repo_dir: &str) {
        fs::write(format!("{}/flake.nix", repo_dir), "{ }\n").unwrap();
        crate::git::commit_all(repo_dir, "initial").unwrap();
    }

    fn repo_with_initial_commit() -> (TempDir, Repository, git2::Oid) {
        let temp_dir = TempDir::new().unwrap();
        let repo = Repository::init(temp_dir.path()).unwrap();
        let commit_id = create_commit(
            &repo,
            temp_dir.path(),
            "flake.nix",
            "{ }\n",
            "initial",
            None,
            Some("HEAD"),
        );

        (temp_dir, repo, commit_id)
    }

    fn create_commit(
        repo: &Repository,
        repo_dir: &Path,
        path: &str,
        contents: &str,
        message: &str,
        parent: Option<git2::Oid>,
        update_ref: Option<&str>,
    ) -> git2::Oid {
        fs::write(repo_dir.join(path), contents).unwrap();

        let mut index = repo.index().unwrap();
        index.add_path(Path::new(path)).unwrap();
        index.write().unwrap();

        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = git2::Signature::now("nixmac", "nixmac@local").unwrap();

        if let Some(parent_id) = parent {
            let parent_commit = repo.find_commit(parent_id).unwrap();
            repo.commit(update_ref, &sig, &sig, message, &tree, &[&parent_commit])
                .unwrap()
        } else {
            repo.commit(update_ref, &sig, &sig, message, &tree, &[])
                .unwrap()
        }
    }

    fn configure_origin_upstream(repo: &Repository, target_oid: git2::Oid) {
        repo.remote("origin", "https://example.invalid/nixmac.git")
            .unwrap();
        repo.reference(
            "refs/remotes/origin/main",
            target_oid,
            true,
            "create remote-tracking branch",
        )
        .unwrap();

        let branch_name = current_branch(repo).unwrap();
        let mut branch = repo.find_branch(&branch_name, BranchType::Local).unwrap();
        branch.set_upstream(Some("origin/main")).unwrap();
    }

    #[test]
    fn decide_auto_update_noops_when_up_to_date() {
        let oid = git2::Oid::from_str("1111111111111111111111111111111111111111").unwrap();
        let status = AutoUpdateGitStatus {
            branch: "main".to_string(),
            upstream_name: "origin/main".to_string(),
            local_oid: oid,
            upstream_oid: oid,
            state: BranchSyncState::UpToDate,
        };

        let AutoUpdateDecision::Noop(message) = decide_auto_update(&status) else {
            panic!("expected noop decision");
        };

        assert!(message.contains("already up to date"));
    }

    #[test]
    fn decide_auto_update_updates_when_behind() {
        let local_oid = git2::Oid::from_str("1111111111111111111111111111111111111111").unwrap();
        let upstream_oid = git2::Oid::from_str("2222222222222222222222222222222222222222").unwrap();
        let status = AutoUpdateGitStatus {
            branch: "main".to_string(),
            upstream_name: "origin/main".to_string(),
            local_oid,
            upstream_oid,
            state: BranchSyncState::Behind,
        };

        let AutoUpdateDecision::UpdateAndRebuild {
            local_oid: actual_local_oid,
            upstream_oid: actual_upstream_oid,
            upstream_name,
        } = decide_auto_update(&status)
        else {
            panic!("expected update decision");
        };

        assert_eq!(actual_local_oid, local_oid);
        assert_eq!(actual_upstream_oid, upstream_oid);
        assert_eq!(upstream_name, "origin/main");
    }

    #[test]
    fn decide_auto_update_warns_and_skips_when_ahead() {
        let oid = git2::Oid::from_str("1111111111111111111111111111111111111111").unwrap();
        let status = AutoUpdateGitStatus {
            branch: "main".to_string(),
            upstream_name: "origin/main".to_string(),
            local_oid: oid,
            upstream_oid: oid,
            state: BranchSyncState::Ahead,
        };

        let AutoUpdateDecision::WarnAndSkip(message) = decide_auto_update(&status) else {
            panic!("expected warning decision");
        };

        assert!(message.contains("ahead of origin/main"));
    }

    #[test]
    fn classify_branch_state_covers_common_relationships() {
        let (temp_dir, repo, initial_oid) = repo_with_initial_commit();

        assert_eq!(
            classify_branch_state(&repo, initial_oid, initial_oid).unwrap(),
            BranchSyncState::UpToDate
        );

        let local_oid = create_commit(
            &repo,
            temp_dir.path(),
            "flake.nix",
            "{ local = true; }\n",
            "local",
            Some(initial_oid),
            Some("HEAD"),
        );

        assert_eq!(
            classify_branch_state(&repo, local_oid, initial_oid).unwrap(),
            BranchSyncState::Ahead
        );
        assert_eq!(
            classify_branch_state(&repo, initial_oid, local_oid).unwrap(),
            BranchSyncState::Behind
        );

        let upstream_oid = create_commit(
            &repo,
            temp_dir.path(),
            "flake.nix",
            "{ upstream = true; }\n",
            "upstream",
            Some(initial_oid),
            None,
        );

        assert_eq!(
            classify_branch_state(&repo, local_oid, upstream_oid).unwrap(),
            BranchSyncState::Diverged
        );
    }

    #[test]
    fn upstream_and_remote_use_current_branch_tracking_config() {
        let (_temp_dir, repo, initial_oid) = repo_with_initial_commit();
        configure_origin_upstream(&repo, initial_oid);

        let (upstream_name, upstream_oid) = upstream_for_current_branch(&repo).unwrap();

        assert_eq!(upstream_name, "origin/main");
        assert_eq!(upstream_oid, initial_oid);
        assert_eq!(remote_name_for_current_branch(&repo).unwrap(), "origin");
    }

    #[test]
    fn inspect_git_status_reports_current_tracking_state() {
        let (_temp_dir, repo, initial_oid) = repo_with_initial_commit();
        configure_origin_upstream(&repo, initial_oid);

        let status = inspect_git_status(&repo).unwrap();

        assert_eq!(status.upstream_name, "origin/main");
        assert_eq!(status.local_oid, initial_oid);
        assert_eq!(status.upstream_oid, initial_oid);
        assert_eq!(status.state, BranchSyncState::UpToDate);
    }

    #[test]
    fn test_is_worktree_clean_for_auto_update_yes() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();

        init_repo(&repo_dir_str).unwrap();
        make_initial_commit(&repo_dir_str);

        assert!(is_worktree_clean_for_auto_update(&repo_dir_str).unwrap());
    }

    #[test]
    fn test_is_worktree_clean_for_auto_update_no() {
        let temp_dir = TempDir::new().unwrap();
        let repo_dir = temp_dir.path().join("repo");
        let repo_dir_str = repo_dir.to_string_lossy().to_string();

        init_repo(&repo_dir_str).unwrap();
        make_initial_commit(&repo_dir_str);

        // Create an untracked file
        let file_path = repo_dir.join("untracked_file.txt");
        fs::write(&file_path, "content").unwrap();

        assert!(!is_worktree_clean_for_auto_update(&repo_dir_str).unwrap());
    }
}
