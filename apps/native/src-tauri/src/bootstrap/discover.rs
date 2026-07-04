//! Locating `flake.nix` files inside an imported configuration tree.
//!
//! Imported repositories don't always keep their flake at the root (dotfiles
//! repos commonly nest it, e.g. `nix/os/flake.nix`). The import flow uses this
//! module to decide where the config directory should actually point.

use std::path::Path;
use walkdir::WalkDir;

/// Default search depth for [`find_flake_dirs`]. Deep enough for typical
/// dotfiles layouts (`nix/os/flake.nix`) without scanning entire vendored
/// trees.
pub const FLAKE_SEARCH_DEPTH: usize = 6;

/// Returns the directories under `root` that contain a `flake.nix`, as
/// relative paths (`""` for the root itself), ordered shallowest-first and
/// alphabetically within a depth.
///
/// The walk prunes `.git`, `node_modules`, and hidden directories below the
/// root, and does not follow symlinks, so vendored or linked trees can't
/// produce spurious (or cyclic) candidates.
pub fn find_flake_dirs(root: &Path, max_depth: usize) -> Vec<String> {
    let mut dirs: Vec<(usize, String)> = WalkDir::new(root)
        .max_depth(max_depth)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 || !entry.file_type().is_dir() {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            name != "node_modules" && !name.starts_with('.')
        })
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file() && entry.file_name() == "flake.nix")
        .filter_map(|entry| {
            let parent = entry.path().parent()?;
            let relative = parent.strip_prefix(root).ok()?;
            Some((entry.depth(), relative.to_string_lossy().into_owned()))
        })
        .collect();

    dirs.sort();
    dirs.into_iter().map(|(_, dir)| dir).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn touch_flake(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("flake.nix"), "{ }").unwrap();
    }

    #[test]
    fn finds_flake_at_root() {
        let tmp = tempfile::tempdir().unwrap();
        touch_flake(tmp.path());

        assert_eq!(find_flake_dirs(tmp.path(), FLAKE_SEARCH_DEPTH), vec![""]);
    }

    #[test]
    fn finds_single_nested_flake() {
        let tmp = tempfile::tempdir().unwrap();
        touch_flake(&tmp.path().join("nix/os"));

        assert_eq!(
            find_flake_dirs(tmp.path(), FLAKE_SEARCH_DEPTH),
            vec!["nix/os"]
        );
    }

    #[test]
    fn orders_multiple_flakes_shallowest_first() {
        let tmp = tempfile::tempdir().unwrap();
        touch_flake(&tmp.path().join("deep/nested/machine"));
        touch_flake(&tmp.path().join("zeta"));
        touch_flake(&tmp.path().join("alpha"));

        assert_eq!(
            find_flake_dirs(tmp.path(), FLAKE_SEARCH_DEPTH),
            vec!["alpha", "zeta", "deep/nested/machine"]
        );
    }

    #[test]
    fn root_flake_sorts_before_nested() {
        let tmp = tempfile::tempdir().unwrap();
        touch_flake(tmp.path());
        touch_flake(&tmp.path().join("nix"));

        assert_eq!(
            find_flake_dirs(tmp.path(), FLAKE_SEARCH_DEPTH),
            vec!["", "nix"]
        );
    }

    #[test]
    fn prunes_git_node_modules_and_hidden_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        touch_flake(&tmp.path().join(".git/some"));
        touch_flake(&tmp.path().join("node_modules/pkg"));
        touch_flake(&tmp.path().join(".config/darwin"));
        touch_flake(&tmp.path().join("real"));

        assert_eq!(
            find_flake_dirs(tmp.path(), FLAKE_SEARCH_DEPTH),
            vec!["real"]
        );
    }

    #[test]
    fn respects_max_depth() {
        let tmp = tempfile::tempdir().unwrap();
        // flake.nix at depth 3 (a/b/flake.nix has the file itself at depth 3).
        touch_flake(&tmp.path().join("a/b"));

        assert_eq!(find_flake_dirs(tmp.path(), 3), vec!["a/b"]);
        assert!(find_flake_dirs(tmp.path(), 2).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_symlinks() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        touch_flake(outside.path());
        std::os::unix::fs::symlink(outside.path(), tmp.path().join("linked")).unwrap();

        assert!(find_flake_dirs(tmp.path(), FLAKE_SEARCH_DEPTH).is_empty());
    }
}
