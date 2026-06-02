use serde::{Deserialize, Serialize};
use specta::Type;

use super::evolve::EvolveState;
use crate::sqlite_types::{Change, ChangeSet, ChangeSummary};

/// HEAD content vs working-tree content for a file, used by the diff tab Monaco DiffEditor.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FileDiffContents {
    pub original: String,
    pub modified: String,
}

/// Type of change for a file in git status.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChangeType {
    /// File was added.
    New,
    /// File contents changed.
    Edited,
    /// File was deleted.
    Removed,
    /// File was renamed or moved.
    Renamed,
}

/// Individual file status parsed from diff headers.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    /// Repository-relative file path.
    pub path: String,
    /// Parsed status category for this file.
    pub change_type: ChangeType,
}

/// Comprehensive git repository status.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// Changed files parsed from git status/diff output.
    pub files: Vec<GitFileStatus>,
    /// Current branch name, when the repository has one checked out.
    pub branch: Option<String>,
    /// Unified diff for the current working tree/index changes.
    pub diff: String,
    /// Total added lines in `diff`.
    pub additions: usize,
    /// Total removed lines in `diff`.
    pub deletions: usize,
    /// Current HEAD commit hash, when available.
    pub head_commit_hash: Option<String>,
    /// Whether HEAD is known to be clean relative to tracked changes.
    pub clean_head: bool,
    /// Raw change rows associated with the current diff.
    pub changes: Vec<Change>,
}

/// Latest git status slice emitted by the git status watcher.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GitState {
    /// Latest git status snapshot, if it could be read.
    pub git_status: Option<GitStatus>,
    /// True when a build outside nixmac was detected.
    pub external_build_detected: bool,
}

/// Result of a successful `git_commit` command.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    /// Hash of the commit that was created.
    pub hash: String,
    /// Evolve state after committing.
    pub evolve_state: EvolveState,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChangeWithSummary {
    /// Change row identifier.
    pub id: i64,
    /// Stable content hash for the change.
    pub hash: String,
    /// Repository-relative changed file path.
    pub filename: String,
    /// Unified diff content for this change.
    pub diff: String,
    /// Number of lines in the change diff.
    pub line_count: i64,
    /// Unix timestamp when the change was recorded.
    pub created_at: i64,
    /// Direct summary row id assigned to this change, if any.
    pub own_summary_id: Option<i64>,
    /// Summary title used for display.
    pub title: String,
    /// Summary description used for display.
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SemanticChangeGroup {
    /// Shared summary describing the grouped changes.
    pub summary: ChangeSummary,
    /// Changes that belong to this semantic group.
    pub changes: Vec<ChangeWithSummary>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SemanticChangeMap {
    /// Groups of changes that share a generated semantic summary.
    pub groups: Vec<SemanticChangeGroup>,
    /// Changes with their own summaries or no group membership.
    pub singles: Vec<ChangeWithSummary>,
    /// Hashes for changes that could not be summarized.
    pub unsummarized_hashes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SummarizedChange {
    /// Raw change row.
    pub change: Change,
    /// Summary attached directly to this change.
    pub own_summary: Option<ChangeSummary>,
    /// Summary inherited from this change's group.
    pub group_summary: Option<ChangeSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SummarizedChangeSet {
    /// Change set represented by this response.
    pub change_set: ChangeSet,
    /// Changes in the set with their available summaries.
    pub changes: Vec<SummarizedChange>,
    /// Change hashes expected in the set but missing from the database.
    pub missed_hashes: Vec<String>,
}

/// A commit entry combining git log data, tag-derived flags, optional DB metadata, and raw diff changes.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    /// Git commit hash represented by this history row.
    pub hash: String,
    /// Commit message, if available from git or local metadata.
    pub message: Option<String>,
    /// Commit timestamp.
    pub created_at: i64,
    /// Whether this commit corresponds to the active build record.
    pub is_built: bool,
    /// Whether this commit is the configured base commit.
    pub is_base: bool,
    /// Whether this commit was created outside nixmac.
    pub is_external: bool,
    /// Number of files changed in this commit.
    pub file_count: usize,
    /// Matching persisted commit row, if one exists.
    pub commit: Option<crate::sqlite_types::Commit>,
    /// Semantic summaries for this commit's changes.
    pub change_map: Option<SemanticChangeMap>,
    /// Change hashes without summaries.
    pub unsummarized_hashes: Vec<String>,
    /// Raw changes parsed for this history item.
    pub raw_changes: Vec<crate::sqlite_types::Change>,
    /// Message of the commit this entry originated from, for restore/orphan flows.
    pub origin_message: Option<String>,
    /// Hash of the commit this entry originated from, for restore/orphan flows.
    pub origin_hash: Option<String>,
    /// Whether this represents a restored build no longer on the visible branch.
    pub is_orphaned_restore: bool,
    /// Whether this history item has been undone by a later restore operation.
    pub is_undone: bool,
}
