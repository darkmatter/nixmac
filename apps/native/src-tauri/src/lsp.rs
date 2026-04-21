//! LSP bridge for nixd.
//!
//! Spawns nixd as a child process and bridges its stdio to the frontend
//! via Tauri commands (send) and events (receive).

use std::sync::Arc;

use log::{debug, error, info, warn};
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::providers::cli::augmented_path;
use crate::store;

/// Global LSP process state, shared across async tasks.
static LSP_PROCESS: std::sync::OnceLock<Arc<Mutex<Option<LspState>>>> = std::sync::OnceLock::new();

fn lsp_state() -> &'static Arc<Mutex<Option<LspState>>> {
    LSP_PROCESS.get_or_init(|| Arc::new(Mutex::new(None)))
}

struct LspState {
    stdin: tokio::process::ChildStdin,
    child: Child,
}

/// Start the nixd LSP server.
pub async fn start(app: &AppHandle) -> Result<(), String> {
    let mut guard = lsp_state().lock().await;
    if guard.is_some() {
        return Err("nixd is already running".into());
    }

    let config_dir = store::get_config_dir(app).map_err(|e| e.to_string())?;
    let path = augmented_path();

    let mut child = Command::new("nixd")
        .arg("--stdio")
        .current_dir(&config_dir)
        .env("PATH", &path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to spawn nixd: {}. Is nixd installed?", e))?;

    let stdin = child.stdin.take().ok_or("Failed to capture nixd stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to capture nixd stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture nixd stderr")?;

    info!("[lsp] nixd started (cwd: {})", config_dir);

    // Spawn stdout reader — reads LSP-framed messages and emits them to the frontend.
    let app_handle = app.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_lsp_message(&mut reader).await {
                Ok(Some(message)) => {
                    debug!("[lsp] ← {}", &message[..message.len().min(200)]);
                    if let Err(e) = app_handle.emit("lsp:message", &message) {
                        error!("[lsp] Failed to emit message: {}", e);
                        break;
                    }
                }
                Ok(None) => {
                    info!("[lsp] nixd stdout closed");
                    break;
                }
                Err(e) => {
                    error!("[lsp] Error reading from nixd: {}", e);
                    break;
                }
            }
        }
    });

    // Spawn stderr reader — log for debugging.
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => break,
                Ok(_) => debug!("[lsp] nixd stderr: {}", line.trim()),
                Err(e) => {
                    warn!("[lsp] Error reading nixd stderr: {}", e);
                    break;
                }
            }
        }
    });

    *guard = Some(LspState { stdin, child });
    Ok(())
}

/// Send a JSON-RPC message to nixd's stdin.
pub async fn send(message: &str) -> Result<(), String> {
    let mut guard = lsp_state().lock().await;
    let state = guard.as_mut().ok_or("nixd is not running")?;

    debug!("[lsp] → {}", &message[..message.len().min(200)]);

    let framed = format!("Content-Length: {}\r\n\r\n{}", message.len(), message);
    state
        .stdin
        .write_all(framed.as_bytes())
        .await
        .map_err(|e| format!("Failed to write to nixd: {}", e))?;
    state
        .stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush nixd stdin: {}", e))?;

    Ok(())
}

/// Stop the nixd LSP server.
pub async fn stop() -> Result<(), String> {
    let mut guard = lsp_state().lock().await;
    if let Some(mut state) = guard.take() {
        info!("[lsp] Stopping nixd");
        // Try graceful shutdown first
        let _ = state.child.kill().await;
        Ok(())
    } else {
        Ok(()) // Already stopped
    }
}

/// Read a single LSP message from a buffered reader.
///
/// LSP uses `Content-Length: N\r\n\r\n{json}` framing.
/// Returns `Ok(None)` on EOF.
async fn read_lsp_message<R: tokio::io::AsyncRead + Unpin>(
    reader: &mut BufReader<R>,
) -> Result<Option<String>, std::io::Error> {
    let mut content_length: Option<usize> = None;
    let mut header_line = String::new();

    // Read headers until we find the empty line
    loop {
        header_line.clear();
        let n = reader.read_line(&mut header_line).await?;
        if n == 0 {
            return Ok(None); // EOF
        }

        let trimmed = header_line.trim();
        if trimmed.is_empty() {
            // End of headers
            break;
        }

        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            if let Ok(len) = value.trim().parse::<usize>() {
                content_length = Some(len);
            }
        }
    }

    let length = content_length.ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "Missing Content-Length header")
    })?;

    // Read exactly `length` bytes for the body
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body).await?;

    String::from_utf8(body)
        .map(Some)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}
