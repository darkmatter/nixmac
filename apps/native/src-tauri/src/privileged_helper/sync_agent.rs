use crate::privileged_helper::protocol::{
    SYNC_AGENT_LABEL, SyncAgentLaunchConfig, sync_agent_plist,
};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncAgentStatus {
    pub label: String,
    pub installed: bool,
    pub loaded: bool,
    pub plist_path: String,
    pub detail: Option<String>,
}

pub fn status() -> SyncAgentStatus {
    let plist_path = plist_path();
    let installed = plist_path.is_file();
    let service_label = launchctl_service_label();
    let loaded = Command::new("/bin/launchctl")
        .args(["print", service_label.as_str()])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);

    SyncAgentStatus {
        label: SYNC_AGENT_LABEL.to_string(),
        installed,
        loaded,
        plist_path: plist_path.to_string_lossy().into_owned(),
        detail: None,
    }
}

pub fn install(
    program_path: &str,
    config: Option<&SyncAgentLaunchConfig>,
) -> Result<SyncAgentStatus> {
    if program_path.trim().is_empty() {
        bail!("sync agent program path is required");
    }

    let path = plist_path();
    let dir = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("LaunchAgents path has no parent"))?;
    fs::create_dir_all(dir)?;
    fs::write(&path, sync_agent_plist(program_path, config))?;

    let path_str = path.to_string_lossy().into_owned();
    let domain = launchctl_user_domain();
    let _ = Command::new("/bin/launchctl")
        .args(["bootout", domain.as_str(), path_str.as_str()])
        .status();
    let output = Command::new("/bin/launchctl")
        .args(["bootstrap", domain.as_str(), path_str.as_str()])
        .output()
        .context("failed to bootstrap sync LaunchAgent")?;
    if !output.status.success() {
        bail!(
            "failed to bootstrap sync LaunchAgent: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    Ok(status())
}

pub fn uninstall() -> Result<SyncAgentStatus> {
    let path = plist_path();
    let path_str = path.to_string_lossy().into_owned();
    let domain = launchctl_user_domain();
    let _ = Command::new("/bin/launchctl")
        .args(["bootout", domain.as_str(), path_str.as_str()])
        .status();
    if path.exists() {
        fs::remove_file(&path)?;
    }
    Ok(status())
}

fn plist_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("Library/LaunchAgents")
        .join(format!("{SYNC_AGENT_LABEL}.plist"))
}

fn launchctl_user_domain() -> String {
    format!("gui/{}", current_uid())
}

fn launchctl_service_label() -> String {
    format!("{}/{}", launchctl_user_domain(), SYNC_AGENT_LABEL)
}

#[cfg(unix)]
fn current_uid() -> u32 {
    // SAFETY: `getuid` is thread-safe, has no preconditions, and cannot fail.
    unsafe { libc::getuid() }
}

#[cfg(not(unix))]
fn current_uid() -> u32 {
    0
}

pub fn bundled_sync_agent_path() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    let macos_dir = exe.parent()?;
    let candidate = macos_dir.join("nixmac-sync-agent");
    Some(candidate.to_string_lossy().into_owned())
}
