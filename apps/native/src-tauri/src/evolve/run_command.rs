//! run_command tool implementation

use super::utils::truncate_error;
use anyhow::Result;
use log::{info, warn};
use std::process::Command;

/// Get the allow-list of "safe" commands that the run_command tool can execute.
/// This includes nix-related commands necessary for configuration management and
/// read-only utilities for exploring the nix codebase. It also includes git
/// commands but only for read-only operations (e.g., git status, git log) to allow the agent
/// to inspect the repository state without making changes. Dangerous commands that can modify
/// the system or the repository (e.g., git commit, git push, rm, mv, etc.) are explicitly blocked
/// in the validation function, even if they are common utilities.
fn get_allowed_run_commands() -> Vec<&'static str> {
    vec![
        // Nix ecosystem commands
        "nix",
        "nix-instantiate",
        "nix-build",
        // "nix-env",   // can run arbitrary code
        // "nix-shell", // can run arbitrary code
        "nixpkgs-fmt",
        "alejandra",
        "statix",
        "nix-prefetch-url",
        "nix-hash",
        // Read-only file operations
        "cat",
        "head",
        "tail",
        "less",
        "more",
        "ls",
        "tree",
        "find",
        "fd",
        "wc",
        "file",
        "stat",
        // Text search and processing (read-only uses)
        "grep",
        "rg",
        "ripgrep",
        "egrep",
        "fgrep",
        "ag",
        "ack",
        "sort",
        "uniq",
        "cut",
        // Git read-only operations
        "git",
        // Path and command utilities
        "which",
        "command",
        "type",
        "whereis",
        "dirname",
        "basename",
        "realpath",
        "readlink",
        "pwd",
        // Output utilities
        "echo",
        "printf",
        // Other safe utilities
        "diff",
        "cmp",
        "md5",
        "shasum",
        "sha256sum",
        "jq",
        "yq",
    ]
}

/// Validates git command to ensure only read-only operations are allowed
fn validate_git_command(trimmed: &str) -> Result<(), String> {
    let git_allowed_subcommands = [
        "status",
        "log",
        "diff",
        "show",
        "rev-parse",
        "describe",
        "ls-files",
        "ls-tree",
        "cat-file",
    ];

    let args: Vec<&str> = trimmed.split_whitespace().collect();
    if args.len() > 1 {
        let subcommand = args[1];
        if !git_allowed_subcommands.contains(&subcommand) {
            return Err(format!(
                "Git subcommand '{}' is not allowed. Only read-only git operations are permitted.",
                subcommand
            ));
        }
    }

    Ok(())
}

/// Validates nix command to ensure only safe read-only operations are allowed
fn validate_nix_command(base_cmd: &str, trimmed: &str) -> Result<(), String> {
    // Block dangerous flags that can execute commands
    let dangerous_nix_flags = ["-c", "--command", "--run"];
    for flag in &dangerous_nix_flags {
        if trimmed.contains(flag) {
            return Err(format!(
                "Nix command contains dangerous flag '{}' which can execute arbitrary commands.",
                flag
            ));
        }
    }

    // For the main nix CLI, validate subcommands
    if base_cmd == "nix" {
        let args: Vec<&str> = trimmed.split_whitespace().collect();
        if args.len() > 1 {
            let subcommand = args[1];

            // Block dangerous subcommands that can execute code
            let blocked_subcommands = ["run", "shell", "develop", "repl", "build", "eval"];
            if blocked_subcommands.contains(&subcommand) {
                return Err(format!(
                    "Nix subcommand '{}' is not allowed because it can execute arbitrary code or trigger builds.",
                    subcommand
                ));
            }

            // Subcommands that need additional sub-subcommand validation
            match subcommand {
                "flake" => {
                    if args.len() > 2 {
                        let flake_subcommand = args[2];
                        let safe_flake_subcommands = ["show", "metadata", "info", "list-inputs"];
                        if !safe_flake_subcommands.contains(&flake_subcommand) {
                            return Err(format!(
                                "Nix flake subcommand '{}' is not allowed. Only read-only flake operations are permitted (show, metadata, info, list-inputs).",
                                flake_subcommand
                            ));
                        }
                    }
                }
                "store" => {
                    if args.len() > 2 {
                        let store_subcommand = args[2];
                        let safe_store_subcommands =
                            ["diff-closures", "path-info", "verify", "ls", "cat"];
                        if !safe_store_subcommands.contains(&store_subcommand) {
                            return Err(format!(
                                "Nix store subcommand '{}' is not allowed. Only read-only store operations are permitted (diff-closures, path-info, verify, ls, cat).",
                                store_subcommand
                            ));
                        }
                    }
                }
                _ => {}
            }

            // Allow specific safe subcommands
            let allowed_subcommands = [
                "search",
                "flake",
                "show-config",
                "show-derivation",
                "path-info",
                "why-depends",
                "hash",
                "store",
                "log",
                "registry",
                "doctor",
            ];

            if !allowed_subcommands.contains(&subcommand) {
                return Err(format!(
                    "Nix subcommand '{}' is not on the allow-list. Only safe read-only operations are permitted.",
                    subcommand
                ));
            }
        }
    }

    Ok(())
}

/// Validates find command to block execution flags
fn validate_find_command(trimmed: &str) -> Result<(), String> {
    let dangerous_find_flags = ["-exec", "-execdir", "-ok", "-okdir"];
    for flag in &dangerous_find_flags {
        if trimmed.contains(flag) {
            return Err(format!(
                "Find command contains dangerous flag '{}' which can execute arbitrary commands. Use read-only find operations only.",
                flag
            ));
        }
    }

    Ok(())
}

/// Validates a single command for the run_command tool with no pipes.
/// Checks that the base command is on the allow-list and that git commands are read-only.
fn validate_single_run_command(cmd: &str, allowed_commands: &[&str]) -> Result<(), String> {
    let trimmed = cmd.trim();

    // Extract the base command (first word)
    let base_cmd = trimmed
        .split_whitespace()
        .next()
        .unwrap_or("")
        .split('/')
        .next_back()
        .unwrap_or("");

    if base_cmd.is_empty() {
        return Err("Empty command".to_string());
    }

    if !allowed_commands.contains(&base_cmd) {
        return Err(format!(
            "Command '{}' is not on the allow-list. Only nix-related and read-only commands are permitted.",
            base_cmd
        ));
    }

    // Apply command-specific validation
    if base_cmd == "git" {
        validate_git_command(trimmed)?;
    } else if base_cmd == "nix" || base_cmd == "nix-instantiate" || base_cmd == "nix-build" {
        validate_nix_command(base_cmd, trimmed)?;
    } else if base_cmd == "find" {
        validate_find_command(trimmed)?;
    }

    Ok(())
}

/// Validates that a command is safe and necessary for nix-darwin configuration management.
/// Returns Ok(()) if allowed, Err with reason if blocked.
fn is_command_allowed(command: &str) -> Result<(), String> {
    let trimmed = command.trim();

    // Block dangerous shell operators (but NOT pipes, which we handle specially)
    // Also block newline characters and backgrounding with '&', since commands are run via `sh -c`.
    let dangerous_operators = ["\n", "\r", ";", "&&", "||", ">", ">>", "<", "$(", "`", "&"];
    for op in &dangerous_operators {
        if trimmed.contains(op) {
            return Err(format!(
                "Command contains dangerous shell operator '{}' which could be used to chain commands",
                op
            ));
        }
    }

    let allowed_commands = get_allowed_run_commands();

    // If the command contains pipes, validate each command in the pipeline.
    // We allow this only because the agent commonly uses pipes to chain read-only
    // commands for exploring the codebase
    // (e.g., "cat file | grep pattern", a very simplistic example but conceptually illustrative).
    if trimmed.contains('|') {
        let pipeline_commands: Vec<&str> = trimmed.split('|').collect();

        for (i, cmd) in pipeline_commands.iter().enumerate() {
            if let Err(reason) = validate_single_run_command(cmd, &allowed_commands) {
                return Err(format!(
                    "Command #{} in pipeline is not allowed: {}",
                    i + 1,
                    reason
                ));
            }
        }

        info!(
            "✓ Validated safe pipeline with {} commands",
            pipeline_commands.len()
        );
        return Ok(());
    }

    // Validate the single command (no pipes)
    validate_single_run_command(trimmed, &allowed_commands)
}

/// Execute a run_command tool call
pub fn execute_run_command(config_dir: &str, command: &str) -> Result<String> {
    // Validate command against allow-list for security
    if let Err(reason) = is_command_allowed(command) {
        warn!("⚠️  BLOCKED COMMAND: '{}' - Reason: {}", command, reason);
        return Ok(format!(
            "ERROR: Command blocked for security reasons.\n\n\
            Command: {}\n\
            Reason: {}\n\n\
            Only nix-related and read-only commands necessary for nix-darwin \
            configuration management are allowed. Use the dedicated tools \
            (read_file, edit_file, search_code, etc.) for most operations.",
            command, reason
        ));
    }

    info!("✓ Running allowed command: {}", command);

    let output = Command::new("sh")
        .args(["-c", command])
        .current_dir(config_dir)
        .env("PATH", crate::nix::get_nix_path())
        .output()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let exit_code = output.status.code().unwrap_or(-1);

    let result = format!(
        "Exit code: {}\n\nSTDOUT:\n{}\n\nSTDERR:\n{}",
        exit_code, stdout, stderr
    );

    Ok(truncate_error(&result, 8000))
}
