//! CoW workspace isolation for future evolve subagents (`pi-iso`).
//!
//! Creates a writable clone of a read-only config tree without a deep copy
//! when the platform supports it (APFS clonefile on macOS, etc.), falling
//! back to `git worktree` / recursive copy.
//!
//! No evolve caller yet; keep the API compiled so subagents can adopt it
//! without reintroducing a path-only dep.
#![allow(dead_code)]

use anyhow::{Context, Result, anyhow};
use log::info;
use pi_iso::{BackendKind, IsoError, backend, resolve};
use std::path::{Path, PathBuf};
use tempfile::TempDir;

/// A temporary isolated view of `lower` that is torn down on drop.
pub struct IsolatedWorkspace {
    _scratch: TempDir,
    lower: PathBuf,
    merged: PathBuf,
    kind: BackendKind,
}

impl IsolatedWorkspace {
    /// Absolute path of the writable merged tree (agent working directory).
    pub fn merged(&self) -> &Path {
        &self.merged
    }

    /// Absolute path of the read-only source tree that was cloned.
    pub fn lower(&self) -> &Path {
        &self.lower
    }

    /// Backend that materialised this workspace.
    pub fn backend_kind(&self) -> BackendKind {
        self.kind
    }

    /// Diff `merged` against `lower` (git diff when applicable).
    pub async fn diff(&self) -> Result<pi_iso::Diff> {
        backend(self.kind)
            .diff(&self.lower, &self.merged)
            .await
            .map_err(iso_to_anyhow)
    }
}

impl Drop for IsolatedWorkspace {
    fn drop(&mut self) {
        if let Err(err) = backend(self.kind).stop(&self.merged) {
            log::warn!(
                "isolation stop failed for {} ({}): {}",
                self.merged.display(),
                self.kind,
                err
            );
        }
    }
}

/// Probe and start an isolated writable clone of `lower` under a temp dir.
///
/// Retries remaining [`pi_iso::resolve`] candidates when `start` returns
/// unavailable (e.g. APFS clone across volumes).
pub fn create_isolated_workspace(lower: &Path) -> Result<IsolatedWorkspace> {
    let lower = lower
        .canonicalize()
        .with_context(|| format!("canonicalize isolation lower {}", lower.display()))?;
    if !lower.is_dir() {
        return Err(anyhow!(
            "isolation lower must be a directory: {}",
            lower.display()
        ));
    }

    let resolution = resolve(None);
    let scratch = TempDir::new().context("create isolation scratch dir")?;
    let merged = scratch.path().join("merged");

    let mut last_err: Option<IsoError> = None;
    for kind in resolution.candidates {
        let be = backend(kind);
        match be.start(&lower, &merged) {
            Ok(()) => {
                info!(
                    "isolation started: backend={} lower={} merged={}",
                    kind,
                    lower.display(),
                    merged.display()
                );
                return Ok(IsolatedWorkspace {
                    _scratch: scratch,
                    lower,
                    merged,
                    kind,
                });
            }
            Err(err) if err.is_unavailable() => {
                log::debug!("isolation backend {kind} unavailable: {err}");
                last_err = Some(err);
                let _ = std::fs::remove_dir_all(&merged);
            }
            Err(err) => return Err(iso_to_anyhow(err)),
        }
    }

    Err(iso_to_anyhow(last_err.unwrap_or_else(|| {
        IsoError::unavailable("no isolation backend available")
    })))
}

fn iso_to_anyhow(err: IsoError) -> anyhow::Error {
    anyhow!("isolation: {err}")
}

#[cfg(test)]
mod tests {
    use super::create_isolated_workspace;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn isolated_workspace_is_writable_clone() {
        let lower = tempdir().expect("lower");
        let repo = git2::Repository::init(lower.path()).expect("init git");
        fs::write(lower.path().join("flake.nix"), "{ }").expect("seed");
        // Seed an initial commit so backends that use git worktrees / git diff
        // have a real HEAD (APFS clonefile itself does not need this).
        {
            let mut index = repo.index().expect("index");
            index
                .add_path(std::path::Path::new("flake.nix"))
                .expect("add");
            let tree_id = index.write_tree().expect("write_tree");
            let tree = repo.find_tree(tree_id).expect("tree");
            let sig = git2::Signature::now("test", "test@example.com").expect("sig");
            repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
                .expect("commit");
        }

        let iso = create_isolated_workspace(lower.path()).expect("start isolation");
        assert!(iso.merged().join("flake.nix").is_file());
        assert!(iso.lower().is_dir());
        assert!(!iso.backend_kind().as_str().is_empty());
        fs::write(iso.merged().join("extra.txt"), "from-agent").expect("write in merged");
        assert!(
            !lower.path().join("extra.txt").exists(),
            "writes must not leak into lower"
        );
        assert_eq!(
            fs::read_to_string(iso.merged().join("extra.txt")).expect("read"),
            "from-agent"
        );

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let diff = rt.block_on(iso.diff()).expect("diff");
        assert!(
            !diff.is_empty(),
            "expected isolation diff to notice extra.txt"
        );
    }
}
