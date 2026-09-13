use super::{ChatCompletionProvider, TokenUsage};
use anyhow::{Result, anyhow};
use async_trait::async_trait;
use log::debug;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

/// Supported CLI tools for AI completion.
#[derive(Debug, Clone)]
pub enum CliTool {
    Claude,
    Codex,
    OpenCode,
}

impl CliTool {
    pub fn binary_name(&self) -> &str {
        match self {
            CliTool::Claude => "claude",
            CliTool::Codex => "codex",
            CliTool::OpenCode => "opencode",
        }
    }

    pub fn display_name(&self) -> &str {
        match self {
            CliTool::Claude => "Claude CLI",
            CliTool::Codex => "Codex CLI",
            CliTool::OpenCode => "OpenCode CLI",
        }
    }

    /// CLI flag used to pass a model name, for tools that accept one.
    /// Claude and Codex accept a model but do not require it: when the
    /// configured model is empty (or the sentinel equal to the binary
    /// name, substituted by the provider-selection code when no model is
    /// set), no flag is passed and the CLI's own default model is used.
    /// OpenCode takes no model flag.
    pub fn model_flag(&self) -> Option<&str> {
        match self {
            CliTool::Claude => Some("--model"),
            CliTool::Codex => Some("--model"),
            CliTool::OpenCode => None,
        }
    }
}

pub struct CliCompletionClient {
    tool: CliTool,
    model: String,
}

impl CliCompletionClient {
    pub fn new(tool: CliTool, model: String) -> Self {
        Self { tool, model }
    }
}

/// Build an augmented PATH that includes common binary install locations.
pub fn augmented_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let existing = std::env::var("PATH").unwrap_or_default();
    format!(
        "{}:{home}/.local/bin:{home}/.cargo/bin:/usr/local/bin:/opt/homebrew/bin",
        existing,
    )
}

/// Spawn a CLI process, pipe `input` to its stdin, and return stdout.
///
/// Shared by both the summarization and evolution CLI providers.
pub async fn run_cli_process(
    binary: &str,
    args: &[&str],
    input: &str,
    timeout_secs: u64,
) -> Result<String> {
    let path = augmented_path();

    // These CLIs are coding agents, not inference endpoints. They discover
    // project configuration (CLAUDE.md/AGENTS.md, settings, hooks) and scope
    // their own file tools relative to the working directory, so inheriting
    // the app's cwd would point a nested agent at whatever directory nixmac
    // happens to be running in. Give every invocation an empty scratch dir.
    let scratch = tempfile::Builder::new()
        .prefix("nixmac-cli-")
        .tempdir()
        .map_err(|e| {
            anyhow!(
                "failed to create a scratch directory for '{}': {}",
                binary,
                e
            )
        })?;

    let mut child = Command::new(binary)
        .args(args)
        .current_dir(scratch.path())
        .env("PATH", &path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            anyhow!(
                "'{}' not found in PATH. Please install it first. ({})",
                binary,
                e
            )
        })?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(input.as_bytes()).await?;
        stdin.flush().await?;
        // stdin dropped here → closes pipe so child sees EOF
    }

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        child.wait_with_output(),
    )
    .await
    .map_err(|_| anyhow!("'{}' timed out after {}s", binary, timeout_secs))?
    .map_err(|e| anyhow!("'{}' failed: {}", binary, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else if !stdout.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            "(no output)".to_string()
        };
        return Err(anyhow!(
            "'{}' exited with {}: {}",
            binary,
            output.status,
            detail
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Extract the text response from raw CLI output based on the tool type.
fn extract_response(tool: &CliTool, raw: &str) -> Result<String> {
    match tool {
        CliTool::Claude => {
            // `claude -p --output-format json` returns:
            // {"type":"result","subtype":"success","is_error":false,"result":"...","cost_usd":...}
            let json: serde_json::Value = serde_json::from_str(raw.trim()).map_err(|e| {
                anyhow!(
                    "Failed to parse Claude CLI JSON: {} — starts with: {}",
                    e,
                    &raw[..raw.len().min(200)]
                )
            })?;

            if json
                .get("is_error")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                let msg = json
                    .get("result")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown error");
                return Err(anyhow!("Claude CLI returned error: {}", msg));
            }

            json.get("result")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| anyhow!("Claude CLI JSON missing 'result' field"))
        }
        CliTool::Codex | CliTool::OpenCode => Ok(raw.trim().to_string()),
    }
}

/// Build the full argv for a CLI provider, including the flags that stop the
/// child from behaving as an agent.
///
/// nixmac calls these binaries as if they were completion endpoints, but each
/// one ships its own file-edit and shell tools. Left unrestricted, a nested
/// agent can mutate the user's configuration without passing through any of
/// the guards in `evolve::tools` — path resolution, the `.nixmac` reservation,
/// gitignore rejection, or the build gate — and nixmac would record the run as
/// having made no edits. A provider is spawned only when its own tools can be
/// turned off by documented flags; otherwise it is refused.
pub(crate) fn invocation_args(tool: &CliTool, model: Option<&str>) -> Result<Vec<String>> {
    let mut args: Vec<String> = match tool {
        // `--tools ""` disables all built-in tools. Per the CLI reference the
        // flag "doesn't affect MCP tools", so those are denied separately, and
        // `--bare` skips hook/plugin/MCP/CLAUDE.md discovery — hooks run
        // commands and are not covered by either tool flag.
        CliTool::Claude => vec![
            "-p".into(),
            "--output-format".into(),
            "json".into(),
            "--bare".into(),
            "--tools".into(),
            String::new(),
            "--disallowedTools".into(),
            "mcp__*".into(),
        ],
        // `codex exec --sandbox read-only` is not containment: openai/codex#4152
        // reports MCP edit tools writing files despite read-only mode, and no
        // documented flag disables MCP for a single invocation. An MCP write
        // takes an absolute path, so the scratch cwd below does not bound it
        // either. Refuse until a verified way to disable those tools exists.
        CliTool::Codex => {
            return Err(anyhow!(
                "The Codex CLI provider is disabled: `--sandbox read-only` does not reliably \
                 stop Codex from writing files (openai/codex#4152 reports MCP edit tools \
                 bypassing it), and there is no documented per-invocation flag to disable \
                 those tools. Pick an API-key provider (OpenRouter, OpenAI, Ollama) or the \
                 Claude CLI in Settings → AI Models."
            ));
        }
        // No documented flag disables OpenCode's own file and shell tools.
        // Spawning it would hand an unrestricted agent write access to the
        // user's machine while nixmac believes it called a completion API.
        CliTool::OpenCode => {
            return Err(anyhow!(
                "The OpenCode CLI provider is disabled: OpenCode has no documented flag to \
                 disable its built-in file and shell tools, so nixmac cannot call it as a \
                 plain completion endpoint. Pick an API-key provider (OpenRouter, OpenAI, \
                 Ollama) or the Claude CLI in Settings → AI Models."
            ));
        }
    };

    if let Some(flag) = tool.model_flag()
        && let Some(m) = model
        && !m.is_empty()
        && m != tool.binary_name()
    {
        args.push(flag.into());
        args.push(m.into());
    }

    Ok(args)
}

#[async_trait]
impl ChatCompletionProvider for CliCompletionClient {
    fn model(&self) -> &str {
        &self.model
    }

    async fn completion(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        _max_tokens: u32,
        _context_window_tokens: Option<u32>,
        _temperature: f32,
        request_id: &str,
    ) -> Result<(String, TokenUsage)> {
        let combined = format!("{}\n\n{}", system_prompt, user_prompt);
        let args = invocation_args(&self.tool, Some(&self.model))?;
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

        debug!(
            "CLI completion via {} [id: {}]",
            self.tool.display_name(),
            request_id
        );

        let raw = run_cli_process(self.tool.binary_name(), &arg_refs, &combined, 300).await?;
        let content = extract_response(&self.tool, &raw)?;
        Ok((
            content,
            TokenUsage {
                input: None,
                output: None,
            },
        ))
    }

    async fn json_completion(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        max_tokens: u32,
        context_window_tokens: Option<u32>,
        temperature: f32,
        request_id: &str,
    ) -> Result<(String, TokenUsage)> {
        let augmented = format!(
            "{}\n\nIMPORTANT: Respond with valid JSON only. No markdown, no code fences.",
            system_prompt
        );
        self.completion(
            &augmented,
            user_prompt,
            max_tokens,
            context_window_tokens,
            temperature,
            request_id,
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::{CliTool, invocation_args, run_cli_process};

    #[test]
    fn claude_is_spawned_with_every_builtin_tool_disabled() {
        let args = invocation_args(&CliTool::Claude, Some("claude-sonnet-5"))
            .expect("claude is spawnable");

        let tools = args
            .iter()
            .position(|a| a == "--tools")
            .expect("claude must be restricted with --tools");
        assert_eq!(
            args[tools + 1],
            "",
            "--tools \"\" is what disables all built-in tools"
        );

        let denied = args
            .iter()
            .position(|a| a == "--disallowedTools")
            .expect("--tools does not cover MCP tools, so they need denying too");
        assert_eq!(args[denied + 1], "mcp__*");

        assert!(
            args.contains(&"--bare".to_string()),
            "hooks execute commands and are not covered by the tool flags"
        );
        assert_eq!(args.last().map(String::as_str), Some("claude-sonnet-5"));
    }

    #[test]
    fn agent_clis_we_cannot_restrict_are_refused() {
        for tool in [CliTool::Codex, CliTool::OpenCode] {
            let err = invocation_args(&tool, None)
                .expect_err("an agent CLI whose own tools cannot be disabled must not be spawned");
            let msg = err.to_string();
            assert!(msg.contains("disabled"), "unexpected: {msg}");
        }
    }

    #[test]
    fn the_sentinel_model_does_not_become_a_model_flag() {
        let args = invocation_args(&CliTool::Claude, Some("claude")).expect("claude is spawnable");
        assert!(
            !args.contains(&"--model".to_string()),
            "the binary-name sentinel means 'use the CLI default'"
        );
    }

    /// A spawned CLI must not be able to see the directory nixmac is running
    /// in, because that is where the user's flake would be. An empty scratch
    /// cwd is what makes every relative path the child could try unresolvable,
    /// so proving the directory is empty and is not the app's cwd is the whole
    /// property — no canary file, and nothing written to the worktree.
    #[test]
    fn a_spawned_cli_runs_in_an_empty_directory_that_is_not_the_apps_cwd() {
        let app_cwd = std::env::current_dir().expect("cwd");

        let out = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(run_cli_process("sh", &["-c", "pwd; ls -A | wc -l"], "", 30))
            .expect("sh should run");

        let mut lines = out.lines();
        let child_cwd = std::path::PathBuf::from(lines.next().expect("pwd line"));
        let entry_count = lines.next().expect("count line").trim().to_string();

        assert_ne!(
            child_cwd, app_cwd,
            "the child must not inherit the app's working directory"
        );
        assert!(
            !child_cwd.starts_with(&app_cwd),
            "the child's cwd must not sit inside the app's working directory: {}",
            child_cwd.display()
        );
        assert_eq!(
            entry_count, "0",
            "an empty scratch cwd is what makes relative paths unresolvable"
        );
    }
}
