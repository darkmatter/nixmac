mod identities;
mod recipients;
pub mod secrets_management;

use crate::evolve::file_ops::resolve_existing_path_in_dir;
use std::path::{Path, PathBuf};

/// Resolve relative declarations from the same directory used as the SOPS
/// command's working directory. Nix path values commonly evaluate to absolute
/// paths (including `/nix/store` paths), so those must remain supported.
fn resolve_secret_file_path(config_dir: &str, file: &str) -> Result<PathBuf, String> {
    let path = Path::new(file);
    let resolved = if path.is_absolute() {
        path.canonicalize()
            .map_err(|error| format!("Failed to resolve secret file {}: {error}", path.display()))?
    } else {
        resolve_existing_path_in_dir(Path::new(config_dir), file)
            .map_err(|error| format!("Failed to resolve secret file {file}: {error}"))?
    };

    if !resolved.is_file() {
        return Err(format!(
            "Secret file {} is not a regular file",
            resolved.display()
        ));
    }

    Ok(resolved)
}
