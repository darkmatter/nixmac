use super::{ChatCompletionProvider, TokenUsage};
use anyhow::{anyhow, Result};
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

    /// Whether this tool should be passed a model name, and if so via which flag.
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

    let mut child = Command::new(binary)
        .args(args)
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
            let json: serde_json::Value =
                serde_json::from_str(raw.trim()).map_err(|e| {
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

/// Build the CLI args for a given tool + optional model override.
fn build_args(tool: &CliTool, model: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = match tool {
        CliTool::Claude => vec![
            "-p".into(),
            "--output-format".into(),
            "json".into(),
        ],
        CliTool::Codex => vec!["--quiet".into()],
        CliTool::OpenCode => vec!["-p".into()],
    };

    if let Some(flag) = tool.model_flag() {
        if let Some(m) = model {
            if !m.is_empty() && m != tool.binary_name() {
                args.push(flag.into());
                args.push(m.into());
            }
        }
    }

    args
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
        _num_ctx: Option<u32>,
        _temperature: f32,
        request_id: &str,
    ) -> Result<(String, TokenUsage)> {
        let combined = format!("{}\n\n{}", system_prompt, user_prompt);
        let args = build_args(&self.tool, Some(&self.model));
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

        debug!(
            "CLI completion via {} [id: {}]",
            self.tool.display_name(),
            request_id
        );

        let raw =
            run_cli_process(self.tool.binary_name(), &arg_refs, &combined, 300).await?;
        let content = extract_response(&self.tool, &raw)?;
        Ok((content, TokenUsage { input: None, output: None }))
    }

    async fn json_completion(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        max_tokens: u32,
        num_ctx: Option<u32>,
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
            num_ctx,
            temperature,
            request_id,
        )
        .await
    }
}
