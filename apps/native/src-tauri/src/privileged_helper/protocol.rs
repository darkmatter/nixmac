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
/// authorization. The app matches on it — only through
/// `HelperResponse::reports_unauthorized_client`, which requires it as a
/// prefix — to fall back to the interactive osascript path instead of
/// surfacing a hard error (unsigned dev builds land here by design).
pub const UNAUTHORIZED_CLIENT_ERROR: &str = "unauthorized helper client";
/// Wire marker for protocol-version skew: the prefix of `ProtocolSkew`'s
/// display form, and therefore of the daemon's response `error` string when
/// a request's version is missing or wrong. Classification cannot cross the
/// JSON boundary, so a *daemon-reported* skew is detected from this marker —
/// only through `HelperResponse::reports_protocol_skew`, which requires it
/// as a prefix. For client-side failures use `is_protocol_skew`, never
/// display text. Kept distinct from `UNAUTHORIZED_CLIENT_ERROR` so a
/// version-skewed helper/app pairing is distinguishable from a rejected
/// client.
pub const UNSUPPORTED_PROTOCOL_ERROR: &str = "unsupported helper protocol version";
/// Wire protocol the daemon and its clients speak. Version 2 dropped every
/// claimed-identity field: the daemon derives the account from the socket
/// peer's credentials, so there is nothing left for a client to assert about
/// itself.
pub const HELPER_PROTOCOL_VERSION: u32 = 2;
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
    /// validated the daemon's signature, the daemon accepted this client,
    /// and both sides proved they speak the same protocol version. A
    /// protocol-error response never sets this.
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

/// The activation target, and nothing else. Account name, uid, and home come
/// from the socket peer's credentials, and the privileged `PATH` is fixed, so
/// a client has nothing left to claim. Unknown fields are rejected rather
/// than ignored: a v1 client's `userName`/`userId`/`home`/`nixPath` must fail
/// loudly, never look like it was honored.
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivateStorePathRequest {
    pub activate_path: String,
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

/// Everything a client puts on the socket. The version is outside the
/// operation so it can be checked before the operation is acted on.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelperRequest {
    pub protocol_version: u32,
    pub op: HelperOp,
}

impl HelperRequest {
    pub fn new(op: HelperOp) -> Self {
        Self {
            protocol_version: HELPER_PROTOCOL_VERSION,
            op,
        }
    }

    /// Daemon-side gate: no operation is derived until the sender is known
    /// to speak this daemon's protocol. The version is probed before the
    /// strict parse so an alien shape is reported as version skew rather
    /// than as whichever unfamiliar field serde trips over first.
    pub fn parse(line: &str) -> Result<HelperOp> {
        check_wire_version(line)?;
        let request: Self = serde_json::from_str(line)?;
        Ok(request.op)
    }
}

/// Classified protocol-version skew. This is the error type behind every
/// version-gate rejection, so consumers detect skew structurally with
/// `is_protocol_skew` instead of parsing display text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProtocolSkew {
    /// Version the other side sent; `None` when the shape carried no
    /// version at all (the v1 wire).
    pub peer_version: Option<u32>,
}

impl std::fmt::Display for ProtocolSkew {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.peer_version {
            Some(version) => write!(
                f,
                "{UNSUPPORTED_PROTOCOL_ERROR} {version} (this build speaks {HELPER_PROTOCOL_VERSION})"
            ),
            None => write!(
                f,
                "{UNSUPPORTED_PROTOCOL_ERROR}: no protocolVersion field (this build speaks {HELPER_PROTOCOL_VERSION})"
            ),
        }
    }
}

impl std::error::Error for ProtocolSkew {}

/// True when `error` is (or wraps) a version-gate `ProtocolSkew`. This is
/// the client-side classification callers act on — the display text is not
/// part of the contract.
pub fn is_protocol_skew(error: &anyhow::Error) -> bool {
    error
        .chain()
        .any(|cause| cause.downcast_ref::<ProtocolSkew>().is_some())
}

/// Reads only `protocolVersion` out of one wire line and requires it to be
/// exactly this build's version. The probe deliberately ignores every other
/// field: its job is to decide whether the rest of the shape may be
/// interpreted at all, so it must parse shapes this build otherwise rejects
/// (v1 carried no version field at all).
fn check_wire_version(line: &str) -> Result<()> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct VersionProbe {
        protocol_version: Option<u32>,
    }

    match serde_json::from_str::<VersionProbe>(line)?.protocol_version {
        Some(HELPER_PROTOCOL_VERSION) => Ok(()),
        peer_version => Err(ProtocolSkew { peer_version }.into()),
    }
}

/// Externally tagged: serde honors `deny_unknown_fields` on a plain payload
/// struct, but ignores it on the variants of an internally tagged enum, and
/// rejecting unknown fields is the point of this shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HelperOp {
    Status,
    ActivateStorePath(ActivateStorePathRequest),
}

/// Everything the daemon puts back on the socket. Every response — status,
/// activation success or failure, and protocol errors alike — carries the
/// version, because the constructors below stamp it and the daemon builds
/// responses only through them. `helper_build_version` is diagnostic (for
/// support and telemetry): release versions are not unique across rebuilds,
/// so the update and trust decisions belong to the signature checks and the
/// version gate, never to this string.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HelperResponse {
    pub protocol_version: u32,
    pub helper_build_version: String,
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
        Self::from_exit(true, 0, stdout.into())
    }

    pub fn error(code: i32, error: impl Into<String>) -> Self {
        Self {
            error: Some(error.into()),
            ..Self::from_exit(false, code, String::new())
        }
    }

    /// Base constructor the other constructors delegate to; also used
    /// directly for a finished activation command, where `ok` mirrors the
    /// exit status. stderr stays empty in every case: the activation merges
    /// its stderr into stdout (`2>&1`), and the other responses have none.
    pub fn from_exit(ok: bool, code: i32, stdout: String) -> Self {
        Self {
            protocol_version: HELPER_PROTOCOL_VERSION,
            helper_build_version: env!("NIXMAC_VERSION").to_string(),
            ok,
            code,
            stdout,
            stderr: String::new(),
            error: None,
        }
    }

    /// Client-side gate, mirroring `HelperRequest::parse`: the version is
    /// checked before `ok`, output, or error fields exist to be read, and a
    /// missing or different version fails as a classified `ProtocolSkew`.
    /// How to recover — reconciling the installed helper, or an interactive
    /// fallback — is the caller's policy, not this layer's contract.
    pub fn parse(line: &str) -> Result<Self> {
        check_wire_version(line)?;
        Ok(serde_json::from_str(line)?)
    }

    /// True when this daemon-reported response is the version gate's own
    /// rejection. The marker is required as a prefix — the daemon puts the
    /// classification first in `error` — so an unrelated failure that merely
    /// mentions the marker text deeper in its message never classifies as
    /// skew.
    pub fn reports_protocol_skew(&self) -> bool {
        self.reports_marker(UNSUPPORTED_PROTOCOL_ERROR)
    }

    /// True when this daemon-reported response is the daemon refusing the
    /// connecting peer. Prefix-matched for the same reason as
    /// `reports_protocol_skew`.
    pub fn reports_unauthorized_client(&self) -> bool {
        self.reports_marker(UNAUTHORIZED_CLIENT_ERROR)
    }

    fn reports_marker(&self, marker: &str) -> bool {
        self.error
            .as_deref()
            .is_some_and(|error| error.starts_with(marker))
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

/// A ready-to-send activation envelope. Opaque on purpose: `activation_request`
/// is the only constructor, so the client's activation entry point cannot be
/// handed a status operation or a hand-assembled envelope with a different
/// version or a non-canonicalized target.
#[derive(Debug, Clone)]
pub struct ActivationRequest(pub(crate) HelperRequest);

/// Builds the versioned activation envelope for the current process.
/// Resolving the path here is a convenience so an obviously wrong target
/// fails before a round trip; the daemon canonicalizes and revalidates
/// independently, and treats nothing in this request as trusted beyond the
/// path it re-derives.
pub fn activation_request(activate_path: &Path) -> Result<ActivationRequest> {
    let canonical = canonicalize_activate_path(activate_path)?;

    Ok(ActivationRequest(HelperRequest::new(
        HelperOp::ActivateStorePath(ActivateStorePathRequest {
            activate_path: canonical.to_string_lossy().into_owned(),
        }),
    )))
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
    fn request_round_trips_at_the_current_version() {
        for op in [
            HelperOp::Status,
            HelperOp::ActivateStorePath(ActivateStorePathRequest {
                activate_path: "/nix/store/abc-darwin-system/activate".to_string(),
            }),
        ] {
            let wire = serde_json::to_string(&HelperRequest::new(op.clone())).expect("serializes");

            assert!(wire.contains(&format!("\"protocolVersion\":{HELPER_PROTOCOL_VERSION}")));
            assert_eq!(HelperRequest::parse(&wire).expect("parses"), op);
        }
    }

    #[test]
    fn request_rejects_other_protocol_versions_before_reading_the_shape() {
        // The operation is deliberately invalid: getting the skew
        // classification rather than an unknown-variant parse error proves
        // the version gate wins before the rest of the shape is interpreted.
        for version in [1, 3, 99] {
            let json = format!("{{\"protocolVersion\":{version},\"op\":\"selfDestruct\"}}");
            let error = HelperRequest::parse(&json).expect_err("version must be rejected");

            assert!(is_protocol_skew(&error));
            assert_eq!(
                error.downcast_ref::<ProtocolSkew>(),
                Some(&ProtocolSkew {
                    peer_version: Some(version)
                })
            );
        }
    }

    #[test]
    fn activation_request_rejects_claimed_identity_fields() {
        // A v1 body at the current version: the claimed account values and
        // requester PATH are a hard parse error now, so they can never look
        // like they were honored.
        let json = format!(
            r#"{{"protocolVersion":{HELPER_PROTOCOL_VERSION},"op":{{"activateStorePath":{{"activatePath":"/nix/store/abc-darwin-system/activate","userName":"alice","userId":501,"home":"/Users/alice","nixPath":"/tmp/attacker-bin"}}}}}}"#
        );

        assert!(HelperRequest::parse(&json).is_err());
    }

    #[test]
    fn request_rejects_unknown_envelope_fields() {
        let json = format!(
            r#"{{"protocolVersion":{HELPER_PROTOCOL_VERSION},"op":"status","userId":501}}"#
        );

        assert!(HelperRequest::parse(&json).is_err());
    }

    #[test]
    fn request_rejects_the_v1_wire_shape_as_protocol_skew() {
        // v1 tagged the operation inline and carried no version at all. Both
        // v1 shapes must be rejected, and classified as version skew rather
        // than a shape error, before any operation is derived.
        for v1 in [
            r#"{"op":"status"}"#,
            r#"{"op":"activateStorePath","request":{"activatePath":"/nix/store/abc-darwin-system/activate","userName":"alice","userId":501,"home":"/Users/alice","nixPath":"/bin"}}"#,
        ] {
            let error = HelperRequest::parse(v1).expect_err("v1 shape must be rejected");

            assert_eq!(
                error.downcast_ref::<ProtocolSkew>(),
                Some(&ProtocolSkew { peer_version: None })
            );
        }
    }

    /// The exact request parser the deployed v1 daemon uses, vendored as a
    /// minimal fixture for the opposite temporal direction of the break.
    #[derive(Deserialize)]
    #[serde(tag = "op", rename_all = "camelCase")]
    enum V1HelperRequest {
        Status,
        ActivateStorePath {
            // Deserialized into but never read, like the payload fields.
            #[allow(dead_code)]
            request: V1ActivateStorePathRequest,
        },
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    #[allow(dead_code)]
    struct V1ActivateStorePathRequest {
        activate_path: String,
        user_name: String,
        user_id: u32,
        home: String,
        nix_path: String,
    }

    #[test]
    fn v1_daemon_parser_cannot_derive_an_activation_from_a_v2_request() {
        // No-double-apply defense: if a still-resident v1 root daemon could
        // parse a v2 activation request, it would execute the activation and
        // answer with a versionless v1 response — which the v2 app rejects
        // as skew, so any recovery it then attempts would re-run an
        // already-finished activation. The v2 activation envelope must
        // therefore be unparseable by the exact v1 request enum.
        let activation = serde_json::to_string(&HelperRequest::new(HelperOp::ActivateStorePath(
            ActivateStorePathRequest {
                activate_path: "/nix/store/abc-darwin-system/activate".to_string(),
            },
        )))
        .expect("serializes");

        assert!(serde_json::from_str::<V1HelperRequest>(&activation).is_err());

        // The v1 daemon does parse a v2 *status* request (its internally
        // tagged enum ignores the unfamiliar protocolVersion field). That is
        // the accepted read-only asymmetry — pinned here so an envelope
        // change that alters it is revisited deliberately.
        let status =
            serde_json::to_string(&HelperRequest::new(HelperOp::Status)).expect("serializes");

        assert!(matches!(
            serde_json::from_str::<V1HelperRequest>(&status),
            Ok(V1HelperRequest::Status)
        ));
    }

    #[test]
    fn every_response_shape_serializes_the_current_version() {
        // Status, activation success, activation failure, and protocol-error
        // responses: all carry the version and the diagnostic build version.
        for response in [
            HelperResponse::ok("nixmac helper ready"),
            HelperResponse::from_exit(true, 0, "activated".to_string()),
            HelperResponse::from_exit(false, 2, "activation exploded".to_string()),
            HelperResponse::error(-1, format!("{UNSUPPORTED_PROTOCOL_ERROR} 1")),
        ] {
            assert!(!response.helper_build_version.is_empty());
            let wire = serde_json::to_string(&response).expect("serializes");

            assert!(wire.contains(&format!("\"protocolVersion\":{HELPER_PROTOCOL_VERSION}")));
            assert!(wire.contains("\"helperBuildVersion\""));
            assert_eq!(HelperResponse::parse(&wire).expect("parses"), response);
        }
    }

    #[test]
    fn response_parse_rejects_the_exact_v1_status_response() {
        // What an installed v1 helper answers a status probe with. It must
        // fail before ok/stdout/error are readable, classified as protocol
        // skew for the caller's recovery policy to act on.
        let v1 = r#"{"ok":true,"code":0,"stdout":"nixmac helper ready","stderr":"","error":null}"#;

        let error = HelperResponse::parse(v1).expect_err("v1 response must be rejected");

        assert!(is_protocol_skew(&error));
        assert_eq!(
            error.downcast_ref::<ProtocolSkew>(),
            Some(&ProtocolSkew { peer_version: None })
        );
    }

    #[test]
    fn response_parse_rejects_other_protocol_versions_before_reading_the_shape() {
        // The rest of the shape is deliberately invalid (missing required
        // fields, an unknown one instead): getting the skew classification
        // rather than a field-level parse error proves the version gate wins
        // before any response field is interpreted.
        for version in [1, 3, 99] {
            let json = format!(r#"{{"protocolVersion":{version},"bogus":true}}"#);

            let error = HelperResponse::parse(&json).expect_err("version must be rejected");

            assert!(is_protocol_skew(&error));
            assert_eq!(
                error.downcast_ref::<ProtocolSkew>(),
                Some(&ProtocolSkew {
                    peer_version: Some(version)
                })
            );
        }
    }

    #[test]
    fn daemon_markers_classify_only_as_prefixes() {
        let skew = HelperResponse::error(
            -1,
            ProtocolSkew {
                peer_version: Some(1),
            }
            .to_string(),
        );
        assert!(skew.reports_protocol_skew());
        assert!(!skew.reports_unauthorized_client());

        let refused =
            HelperResponse::error(-1, format!("{UNAUTHORIZED_CLIENT_ERROR}: bad signature"));
        assert!(refused.reports_unauthorized_client());
        assert!(!refused.reports_protocol_skew());

        // An unrelated failure that merely mentions a marker deeper in its
        // message must not classify.
        let unrelated = HelperResponse::error(
            1,
            format!(
                "activation failed: log mentioned '{UNSUPPORTED_PROTOCOL_ERROR}' and '{UNAUTHORIZED_CLIENT_ERROR}'"
            ),
        );
        assert!(!unrelated.reports_protocol_skew());
        assert!(!unrelated.reports_unauthorized_client());
        assert!(!HelperResponse::ok("nixmac helper ready").reports_protocol_skew());
    }

    #[test]
    fn response_parse_rejects_unknown_fields() {
        let wire = serde_json::to_string(&HelperResponse::ok("ready")).expect("serializes");
        let with_extra = wire.replacen('{', r#"{"sshAuthSock":"/tmp/ssh.sock","#, 1);

        assert!(HelperResponse::parse(&with_extra).is_err());
    }

    fn response(stdout: &str, stderr: &str, error: Option<&str>) -> HelperResponse {
        HelperResponse {
            stderr: stderr.to_string(),
            error: error.map(String::from),
            ..HelperResponse::from_exit(false, 1, stdout.to_string())
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
