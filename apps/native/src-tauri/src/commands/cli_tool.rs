use crate::shared_types;
use std::process::Command;

/// Check which CLI tools (claude, codex, opencode) are available in PATH.
/// Returns a map of tool name → available boolean.
#[tauri::command]
pub async fn check_cli_tools() -> Result<shared_types::CliToolsState, String> {
    use crate::ai::providers::cli::augmented_path;
    let path = augmented_path();
    let check = |tool: &str| -> bool {
        std::process::Command::new("which")
            .arg(tool)
            .env("PATH", &path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    };
    Ok(shared_types::CliToolsState {
        claude: check("claude"),
        codex: check("codex"),
        opencode: check("opencode"),
    })
}

/// List available models for a CLI tool (currently only opencode supports this).
#[tauri::command]
pub async fn list_cli_models(tool: String) -> Result<Vec<String>, String> {
    use crate::ai::providers::cli::augmented_path;
    if tool != "opencode" {
        return Ok(vec![]);
    }
    let path = augmented_path();
    let output = Command::new("opencode")
        .arg("models")
        .env("PATH", &path)
        .output()
        .map_err(|e| format!("Failed to run 'opencode models': {e}"))?;
    if !output.status.success() {
        return Ok(vec![]);
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let models: Vec<String> = stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    Ok(models)
}
