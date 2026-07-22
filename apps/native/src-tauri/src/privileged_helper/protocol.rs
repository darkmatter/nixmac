use anyhow::{Result, anyhow, bail};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Component, Path, PathBuf};

pub const HELPER_LABEL: &str = "com.darkmatter.nixmac.helper";
pub const SYNC_AGENT_LABEL: &str = "com.darkmatter.nixmac.sync-agent";
#[cfg(target_os = "macos")]
pub const HELPER_PLIST_NAME: &str = "com.darkmatter.nixmac.helper.plist";
#[allow(dead_code)]
pub const SYNC_AGENT_PLIST_NAME: &str = "com.darkmatter.nixmac.sync-agent.plist";
pub const HELPER_SOCKET_PATH: &str = "/var/run/nixmac/helper.sock";
#[allow(dead_code)]
pub const HELPER_SOCKET_DIR: &str = "/var/run/nixmac";
/// Prefix of the daemon's response when the connecting peer fails
/// authorization. The app matches on it to fall back to the interactive
/// osascript path instead of surfacing a hard error (unsigned dev builds
/// land here by design).
pub const UNAUTHORIZED_CLIENT_ERROR: &str = "unauthorized helper client";
const DEFAULT_SYNC_AGENT_INTERVAL_SECONDS: u32 = 900;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HelperServiceStatus {
    pub label: String,
    pub available: bool,
    pub registered: bool,
    pub authorized: bool,
    pub socket_available: bool,
    /// The daemon answered an authenticated status round-trip: the client
    /// validated the daemon's signature and the daemon accepted this client.
    pub responding: bool,
    pub detail: Option<String>,
}

impl HelperServiceStatus {
    pub fn unavailable(detail: impl Into<String>) -> Self {
        Self {
            label: HELPER_LABEL.to_string(),
            available: false,
            registered: false,
            authorized: false,
            socket_available: false,
            responding: false,
            detail: Some(detail.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActivateStorePathRequest {
    pub activate_path: String,
    pub user_name: String,
    pub user_id: u32,
    pub home: String,
    pub ssh_auth_sock: Option<String>,
    pub nix_path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncAgentLaunchConfig {
    pub config_dir: Option<String>,
    pub host_attr: Option<String>,
    pub sync_pull: bool,
    pub unattended_apply: bool,
    pub start_interval_seconds: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum HelperRequest {
    Status,
    ActivateStorePath { request: ActivateStorePathRequest },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HelperResponse {
    pub ok: bool,
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    pub error: Option<String>,
}

/// Prefix the helper puts on post-activation maintenance warnings appended to
/// the (merged) stdout, so consumers can surface them.
pub const HELPER_WARNING_PREFIX: &str = "nixmac-helper: warning:";

impl HelperResponse {
    /// Human-readable failure detail: the explicit error when present, else
    /// stderr, else the tail of stdout — the helper merges the activation's
    /// stderr into stdout (`2>&1`), so on a plain nonzero exit the detail
    /// lives there. Used by the sync-agent binary (this file is `include!`d
    /// there), hence dead code in targets that report through other paths.
    #[allow(dead_code)]
    pub fn failure_detail(&self) -> String {
        if let Some(error) = self.error.as_deref().filter(|error| !error.is_empty()) {
            return error.to_string();
        }
        if !self.stderr.is_empty() {
            return self.stderr.clone();
        }
        let lines: Vec<&str> = self
            .stdout
            .lines()
            .filter(|line| !line.is_empty())
            .collect();
        lines[lines.len().saturating_sub(20)..].join("\n")
    }

    /// Post-activation maintenance warnings embedded in stdout.
    #[allow(dead_code)]
    pub fn warnings(&self) -> Vec<&str> {
        self.stdout
            .lines()
            .filter(|line| line.starts_with(HELPER_WARNING_PREFIX))
            .collect()
    }

    pub fn ok(stdout: impl Into<String>) -> Self {
        Self {
            ok: true,
            code: 0,
            stdout: stdout.into(),
            stderr: String::new(),
            error: None,
        }
    }

    pub fn error(code: i32, error: impl Into<String>) -> Self {
        Self {
            ok: false,
            code,
            stdout: String::new(),
            stderr: String::new(),
            error: Some(error.into()),
        }
    }
}

pub fn validate_canonical_activate_path(path: impl AsRef<Path>) -> Result<PathBuf> {
    let path = path.as_ref();
    if !path.is_absolute() {
        bail!("activation path must be absolute");
    }

    if path
        .components()
        .any(|component| !matches!(component, Component::RootDir | Component::Normal(_)))
    {
        bail!("activation path must not contain relative components");
    }

    if !path.starts_with("/nix/store") {
        bail!("activation path must be inside /nix/store");
    }

    if path.file_name().and_then(|part| part.to_str()) != Some("activate") {
        bail!("activation path must end with /activate");
    }

    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("activation path is missing parent directory"))?;
    if parent.parent() != Some(Path::new("/nix/store")) {
        bail!("activation path must be directly under a nix store item");
    }

    Ok(path.to_path_buf())
}

pub fn canonicalize_activate_path(path: impl AsRef<Path>) -> Result<PathBuf> {
    let canonical = std::fs::canonicalize(path)?;
    validate_canonical_activate_path(&canonical)
}

pub fn current_user_activation_request(activate_path: &Path) -> Result<ActivateStorePathRequest> {
    let canonical = canonicalize_activate_path(activate_path)?;
    let user_name = whoami::username().unwrap_or_else(|_| "root".to_string());
    let user_id = current_user_id();
    let home = std::env::var("HOME").unwrap_or_default();
    let ssh_auth_sock = std::env::var("SSH_AUTH_SOCK")
        .ok()
        .filter(|value| !value.is_empty());
    let nix_path = crate::system::nix::get_nix_path();

    Ok(ActivateStorePathRequest {
        activate_path: canonical.to_string_lossy().into_owned(),
        user_name,
        user_id,
        home,
        ssh_auth_sock,
        nix_path,
    })
}

#[cfg(unix)]
fn current_user_id() -> u32 {
    // SAFETY: `getuid` is thread-safe, has no preconditions, and cannot fail.
    unsafe { libc::getuid() }
}

#[cfg(not(unix))]
fn current_user_id() -> u32 {
    0
}

#[allow(dead_code)]
pub fn helper_launch_daemon_plist() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{HELPER_LABEL}</string>
  <key>BundleProgram</key>
  <string>Contents/MacOS/nixmac-helper</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>AssociatedBundleIdentifiers</key>
  <array>
    <string>com.darkmatter.nixmac</string>
    <string>com.darkmatter.nixmac.dev</string>
  </array>
  <key>StandardOutPath</key>
  <string>/Library/Logs/nixmac-helper.log</string>
  <key>StandardErrorPath</key>
  <string>/Library/Logs/nixmac-helper.err.log</string>
</dict>
</plist>
"#
    )
}

pub fn sync_agent_plist(program_path: &str, config: Option<&SyncAgentLaunchConfig>) -> String {
    let interval = config
        .and_then(|config| config.start_interval_seconds)
        .unwrap_or(DEFAULT_SYNC_AGENT_INTERVAL_SECONDS);
    let env = sync_agent_environment_xml(config);
    let program_path = escape_xml(program_path);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{SYNC_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{program_path}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
{env}  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StartInterval</key>
  <integer>{interval}</integer>
  <key>StandardOutPath</key>
  <string>~/Library/Logs/nixmac-sync-agent.log</string>
  <key>StandardErrorPath</key>
  <string>~/Library/Logs/nixmac-sync-agent.err.log</string>
</dict>
</plist>
"#
    )
}

fn sync_agent_environment_xml(config: Option<&SyncAgentLaunchConfig>) -> String {
    let Some(config) = config else {
        return String::new();
    };
    let mut entries = Vec::new();
    if let Some(config_dir) = &config.config_dir {
        entries.push(("NIXMAC_SYNC_CONFIG_DIR", config_dir.as_str()));
    }
    if let Some(host_attr) = &config.host_attr {
        entries.push(("NIXMAC_SYNC_HOST_ATTR", host_attr.as_str()));
    }
    if config.sync_pull {
        entries.push(("NIXMAC_SYNC_PULL", "1"));
    }
    if config.unattended_apply {
        entries.push(("NIXMAC_UNATTENDED_APPLY", "1"));
    }
    if entries.is_empty() {
        return String::new();
    }

    let mut xml = String::from("  <key>EnvironmentVariables</key>\n  <dict>\n");
    for (key, value) in entries {
        xml.push_str(&format!(
            "    <key>{}</key>\n    <string>{}</string>\n",
            escape_xml(key),
            escape_xml(value)
        ));
    }
    xml.push_str("  </dict>\n");
    xml
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_accepts_direct_nix_store_activate_path() {
        let path = validate_canonical_activate_path(
            "/nix/store/abc123-darwin-system-25.05.20260629/activate",
        )
        .expect("valid activate path");

        assert_eq!(
            path,
            PathBuf::from("/nix/store/abc123-darwin-system-25.05.20260629/activate")
        );
    }

    #[test]
    fn validate_rejects_non_store_paths() {
        assert!(validate_canonical_activate_path("/tmp/result/activate").is_err());
    }

    #[test]
    fn validate_rejects_nested_store_paths() {
        assert!(
            validate_canonical_activate_path(
                "/nix/store/abc123-darwin-system-25.05.20260629/bin/activate"
            )
            .is_err()
        );
    }

    #[test]
    fn validate_rejects_relative_components() {
        assert!(
            validate_canonical_activate_path(
                "/nix/store/abc123-darwin-system-25.05.20260629/../activate"
            )
            .is_err()
        );
    }

    #[test]
    fn activation_request_json_ignores_removed_link_field() {
        // Wire compat with apps that still send canonicalLinkTarget: unknown
        // fields are ignored on deserialization.
        let json = r#"{"activatePath":"/nix/store/abc-darwin-system/activate","userName":"alice","userId":501,"home":"/Users/alice","sshAuthSock":null,"nixPath":"/bin","canonicalLinkTarget":"/Users/alice/.darwin"}"#;
        let request: ActivateStorePathRequest = serde_json::from_str(json).expect("deserializes");
        assert_eq!(request.user_id, 501);
    }

    fn response(stdout: &str, stderr: &str, error: Option<&str>) -> HelperResponse {
        HelperResponse {
            ok: false,
            code: 1,
            stdout: stdout.to_string(),
            stderr: stderr.to_string(),
            error: error.map(String::from),
        }
    }

    #[test]
    fn failure_detail_prefers_error_then_stderr_then_stdout_tail() {
        assert_eq!(
            response("out", "err", Some("boom")).failure_detail(),
            "boom"
        );
        assert_eq!(response("out", "err", None).failure_detail(), "err");
        // The helper merges activation stderr into stdout, so a plain nonzero
        // exit must still produce a detail.
        assert_eq!(
            response("activation exploded\n", "", None).failure_detail(),
            "activation exploded"
        );
    }

    #[test]
    fn failure_detail_returns_stdout_tail_only() {
        let lines: Vec<String> = (1..=30).map(|n| format!("line {n}")).collect();
        let detail = response(&lines.join("\n"), "", None).failure_detail();

        assert!(detail.starts_with("line 11"));
        assert!(detail.ends_with("line 30"));
    }

    #[test]
    fn warnings_extracts_prefixed_stdout_lines() {
        let stdout = format!(
            "activated\n{HELPER_WARNING_PREFIX} failed to update system profile\nplain line"
        );
        let with_warning = response(&stdout, "", None);

        assert_eq!(
            with_warning.warnings(),
            vec![format!(
                "{HELPER_WARNING_PREFIX} failed to update system profile"
            )]
        );
        assert!(
            response("no warnings here\n", "", None)
                .warnings()
                .is_empty()
        );
    }

    #[test]
    fn helper_plist_uses_bundle_program_for_smappservice() {
        let plist = helper_launch_daemon_plist();

        assert!(plist.contains("<key>BundleProgram</key>"));
        assert!(plist.contains("Contents/MacOS/nixmac-helper"));
        assert!(plist.contains(HELPER_LABEL));
    }

    #[test]
    fn sync_agent_plist_contains_program_path_and_interval() {
        let plist = sync_agent_plist(
            "/Applications/nixmac.app/Contents/MacOS/nixmac-sync-agent",
            None,
        );

        assert!(plist.contains("/Applications/nixmac.app/Contents/MacOS/nixmac-sync-agent"));
        assert!(plist.contains("<key>StartInterval</key>"));
        assert!(plist.contains(SYNC_AGENT_LABEL));
    }

    #[test]
    fn sync_agent_plist_includes_launch_config_environment() {
        let plist = sync_agent_plist(
            "/Applications/nixmac.app/Contents/MacOS/nixmac-sync-agent",
            Some(&SyncAgentLaunchConfig {
                config_dir: Some("/Users/alice/.darwin".to_string()),
                host_attr: Some("alice-mac".to_string()),
                sync_pull: true,
                unattended_apply: true,
                start_interval_seconds: Some(60),
            }),
        );

        assert!(plist.contains("NIXMAC_SYNC_CONFIG_DIR"));
        assert!(plist.contains("/Users/alice/.darwin"));
        assert!(plist.contains("NIXMAC_UNATTENDED_APPLY"));
        assert!(plist.contains("<integer>60</integer>"));
    }
}
