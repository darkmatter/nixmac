mod identities;
mod recipients;
pub mod secrets_management;

use crate::evolve::file_ops::resolve_existing_path_in_dir;
use std::path::{Path, PathBuf};

/// Convert a failed subprocess result into a caller-supplied, safe error.
///
/// Commands in this module can receive private identity material, and some of
/// them may repeat that input on stderr. Keep all such output out of errors
/// returned to the UI or subsequently written to logs.
fn sanitized_subprocess_error(safe_error: &'static str, _output: &std::process::Output) -> String {
    safe_error.to_string()
}

/// Whether the current process can open a file for reading.
fn is_readable_file(path: impl AsRef<Path>) -> bool {
    std::fs::File::open(path).is_ok()
}

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

#[cfg(test)]
mod tests {
    use std::path::Path;

    use crate::secrets::resolve_secret_file_path;

    #[test]
    fn test_resolve_secret_file_path() {
        let config_dir = "/tmp";
        let file = "test_secret.txt";

        // Create a temporary file for testing
        let temp_file_path = Path::new(config_dir).join(file);
        std::fs::write(&temp_file_path, "secret content").unwrap();

        // Test resolving the relative path
        let resolved_path = resolve_secret_file_path(config_dir, file).unwrap();
        assert_eq!(resolved_path, temp_file_path.canonicalize().unwrap());

        // Clean up the temporary file
        std::fs::remove_file(temp_file_path).unwrap();
    }
}
