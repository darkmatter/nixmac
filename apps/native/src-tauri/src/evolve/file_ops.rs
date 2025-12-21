//! Evolution module for AI-assisted configuration changes.
//!
//! An evolution represents a proposed configuration change (e.g., installing an app,
//! customizing settings). Each evolution is backed by git commits for traceability.
//!
//! Uses OpenAI function calling to generate structured file edits.

use similar::TextDiff;
use std::path::Path;

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MODEL: &str = "gpt-5.1";
const MAX_TOKENS: u32 = 65_000;

const SYSTEM_PROMPT: &str = r#"You are an expert at modifying Nix configurations for macOS systems using nix-darwin and home-manager. Your task is to edit the files in the given repository to make the changes requested by the user.

## About the repository
The repository is a Nix configuration for macOS systems using nix-darwin and home-manager.

## Directory structure
The repository is organized into the following directories:
```
.
├── flake.nix                    # Flake configuration
├── flake-modules/               # Flake-level configuration (outputs)
│   ├── default.nix              # Imports all modules
│   ├── darwin.nix               # Darwin configurations builder
│   ├── home.nix                 # Home-manager configurations
│   ├── packages.nix             # Custom packages/apps
│   └── dev-shells.nix           # Dev shell setup
├── users/
│   └── default.nix              # User profiles (username, email, keys)
├── hosts/                       # Machine configs (darwin + home together)
│   ├── macbook-pro/
│   │   ├── default.nix          # Darwin config
│   │   └── home.nix             # Home-manager config
│   └── coopers-mac-studio/
│       ├── default.nix
│       └── home.nix
├── modules/
│   ├── darwin/                  # nix-darwin modules
│   │   ├── default.nix          # Imports all darwin modules
│   │   ├── core.nix             # Nix config, users, security
│   │   ├── packages.nix         # System packages + scripts
│   │   ├── homebrew.nix         # Homebrew taps/brews/casks
│   │   ├── fonts.nix            # Font packages
│   │   ├── defaults.nix         # macOS preferences
│   │   └── scripts/             # CLI scripts (darwin, pkg?)
│   └── home/                    # home-manager modules
│       ├── default.nix          # Imports all HM modules
│       ├── xdg.nix              # XDG directories
│       ├── theme.nix            # Theming
│       └── programs/            # Individual programs as single files
│           ├── git.nix
│           ├── zsh.nix
│           ├── nvim.nix
│           └── ...
```
## About the changes
The changes are requested by the user.

## About the tools
The tools are provided to read and edit files in the repository.

## About the output
When asked to make changes:
1. Read the relevant files first using read_file
2. Make precise, minimal edits using edit_file
3. Prefer single-file changes when possible for composability
4. Use proper Nix syntax and idioms

Always use the provided tools to read and edit files. Do not output raw code."#;

/// Apply an evolution's edits to the filesystem.
pub fn apply_file_edits(config_dir: &str, edit: &super::types::FileEdit) -> anyhow::Result<()> {
    let full_path = Path::new(config_dir).join(&edit.path);

    if edit.search.is_empty() {
        // New file
        if let Some(parent) = full_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&full_path, &edit.replace)?;
    } else {
        // Edit existing file
        let content = std::fs::read_to_string(&full_path)?;

        // Verify search string exists and is unique
        let count = content.matches(&edit.search).count();
        if count == 0 {
            return Err(anyhow::anyhow!(
                "Search string not found in {}: {:?}",
                edit.path,
                edit.search.chars().take(50).collect::<String>()
            ));
        }
        if count > 1 {
            return Err(anyhow::anyhow!(
                "Search string found {} times in {} (must be unique)",
                count,
                edit.path
            ));
        }

        let new_content = content.replace(&edit.search, &edit.replace);
        std::fs::write(&full_path, new_content)?;
    }

    Ok(())
}

/// Preview what changes an evolution would make (dry run).
pub fn preview_evolution(
    config_dir: &str,
    evolution: &super::types::Evolution,
) -> anyhow::Result<Vec<String>> {
    let mut previews = Vec::new();

    for edit in &evolution.edits {
        let full_path = Path::new(config_dir).join(&edit.path);

        if edit.search.is_empty() {
            previews.push(format!("CREATE {}\n{}", edit.path, &edit.replace));
        } else if full_path.exists() {
            let content = std::fs::read_to_string(&full_path)?;
            let new_content = content.replace(&edit.search, &edit.replace);

            // Generate proper unified diff
            let diff = TextDiff::from_lines(&content, &new_content);
            previews.push(format!(
                "EDIT {}\n{}",
                edit.path,
                diff.unified_diff().context_radius(2).to_string()
            ));
        } else {
            previews.push(format!("MISSING {}", edit.path));
        }
    }

    Ok(previews)
}
