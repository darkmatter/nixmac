use crate::privileged_helper::peer_auth::ClientKind;
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
/// Build identity compiled into this binary (`build.rs` embeds it for the GUI,
/// helper, and sync-agent targets alike). It identifies a build and nothing
/// else: the only operation performed on it is exact string equality, so no
/// syntax is required or checked — not here, and not on any peer's value.
pub const BUILD_ID: &str = env!("NIXMAC_BUILD_ID");
const DEFAULT_SYNC_AGENT_INTERVAL_SECONDS: u32 = 900;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HelperServiceStatus {
    pub label: String,
    pub available: bool,
    pub registered: bool,
    pub authorized: bool,
    pub socket_available: bool,
    /// The daemon answered an authenticated `Status` round-trip naming a
    /// state: the client validated the daemon's signature and the daemon
    /// accepted this client. A typed refusal or an unparseable reply never
    /// sets this.
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

// ---------------------------------------------------------------------------
// Requests.
//
// Three request shapes, tagged by `kind`, and the set is closed forever. A
// request either parses completely or is not understood: there is no envelope
// to read separately from a body, and no version field — a receiver that
// cannot parse a request cannot serve it either way.
//
// `Status` and `Retire` are the cross-build control language and are frozen
// forever: a new GUI must be able to ask an older installed helper what it is
// and to retire it. `TryActivate` only ever succeeds between binaries of the
// same build (it carries a build ID that must equal the helper's), so its
// shape may evolve freely.
// ---------------------------------------------------------------------------

/// The `TryActivate` activation body: the client-generated request ID and the
/// activation script path. NOT frozen. Unknown fields are rejected so a field
/// this build does not honor can never look like it was.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TryActivateBody {
    pub request_id: String,
    pub script_path: String,
}

/// Everything a client may put on the socket. `Status` and `Retire` are
/// kind-only: they carry no build ID because they are exactly the requests
/// that must work across builds. FROZEN — the `kind` tags and the two
/// kind-only shapes may never change, and no kind may ever be added.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HelperRequest {
    Status,
    Retire,
    /// The sender's build ID plus its activation body. The helper compares the
    /// ID after parsing the whole request, as a race guard on an exchange that
    /// is only ever same-build.
    #[serde(rename_all = "camelCase")]
    TryActivate {
        build_id: String,
        body: TryActivateBody,
    },
}

impl HelperRequest {
    /// Serializes one request line, without the trailing newline the caller
    /// appends.
    pub fn encode(&self) -> String {
        serde_json::to_string(self).expect("helper request serializes")
    }

    /// Reads one wire line. `None` means the request is not understood — not
    /// JSON, an unknown kind, or a malformed activation body — which the
    /// helper answers with the frozen request-not-understood refusal. Unknown
    /// fields on a known kind are ignored, so a future build's `Status` still
    /// reads as `Status`.
    pub fn parse(line: &str) -> Option<Self> {
        serde_json::from_str(line).ok()
    }
}

// ---------------------------------------------------------------------------
// Replies.
// ---------------------------------------------------------------------------

/// The four helper states, named verbatim in `Status` replies so every
/// caller can distinguish them. Part of the frozen surface.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HelperStateName {
    Idle,
    Activating,
    /// An activation is still running and retirement is latched: this helper
    /// will never start another one.
    Retiring,
    Retired,
}

impl std::fmt::Display for HelperStateName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            HelperStateName::Idle => "idle",
            HelperStateName::Activating => "activating",
            HelperStateName::Retiring => "retiring",
            HelperStateName::Retired => "retired",
        })
    }
}

/// X: the in-flight activation's identity — the client-generated request ID
/// and script path from the `TryActivate` body, plus the submitting client's
/// kind, which the helper stamps from its own validation of that client,
/// never from the body. Informational only; no decision branches on these
/// fields. Its representation inside `Status` and `Busy(X)` replies is part
/// of the frozen surface.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActivationInfo {
    pub request_id: String,
    pub script_path: String,
    pub client_kind: ClientKind,
}

/// A finished activation's result, sent on the same connection when the
/// activation completes; within this protocol it is the only way to learn an
/// activation's outcome. NOT frozen — it never crosses builds. There is no
/// stderr field: the activation runs with stderr merged into stdout, so
/// `stdout` is the whole interleaved log and helper-level failures use
/// `error`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActivationResult {
    pub ok: bool,
    pub code: i32,
    pub stdout: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Prefix the helper puts on post-activation maintenance warnings appended to
/// the (merged) stdout, so consumers can surface them.
pub const HELPER_WARNING_PREFIX: &str = "nixmac-helper: warning:";

impl ActivationResult {
    /// Human-readable failure detail: the explicit error when present, else
    /// the tail of stdout — the helper merges the activation's stderr into
    /// stdout, so on a plain nonzero exit the detail lives there. Used by the
    /// sync-agent binary (this file is `include!`d there), hence dead code in
    /// targets that report through other paths.
    #[allow(dead_code)]
    pub fn failure_detail(&self) -> String {
        if let Some(error) = self.error.as_deref().filter(|error| !error.is_empty()) {
            return error.to_string();
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
}

/// Everything the helper puts back on the socket, tagged by `reply`.
///
/// Frozen forever: the `Status` reply (including X's representation), the
/// `Retired` and `Busy(X)` replies, and the three typed refusals
/// (`BuildMismatch`, `CallerNotPermitted`, `RequestNotUnderstood`). The
/// `ActivationResult` reply is NOT frozen — it never crosses builds.
///
/// Refusals are typed wire shapes; nothing classifies a reply from display
/// strings.
///
/// The `reply` tag of every frozen variant below may NEVER be renamed or
/// removed: a new GUI must be able to parse the replies of the older installed
/// helper it is replacing, and that is the direction every upgrade depends on.
///
/// Adding a variant is a separate question, and the reply table answers it:
/// each request already has a fixed set of permitted replies, so a new variant
/// may not be sent in answer to `Status` or `Retire` regardless of whether
/// older clients could parse it. A genuinely new reply belongs on an unfrozen
/// exchange (today, only `TryActivate`'s result).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "reply", rename_all = "camelCase")]
pub enum HelperReply {
    /// State named verbatim, the helper's build ID, and X while an activation
    /// runs. This is the cross-build discovery exchange: the build ID is read
    /// whatever it contains, empty included — an empty ID is simply unequal to
    /// this build's, never a reason to reject the reply.
    #[serde(rename_all = "camelCase")]
    Status {
        state: HelperStateName,
        helper_build_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        activation: Option<ActivationInfo>,
    },
    /// To `Retire`: the helper is in the `Retired` state NOW — the
    /// safe-to-unregister signal for a running helper. To `TryActivate`: this
    /// helper will never start the caller's activation (permanent for this
    /// process); `activation` carries X while a retirement-latched activation
    /// is still finishing.
    Retired {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        activation: Option<ActivationInfo>,
    },
    /// To `TryActivate`: an activation is running; transient. To `Retire`:
    /// retirement is latched, X still running — not safe to unregister yet.
    Busy { activation: ActivationInfo },
    /// The completion-time result of an admitted `TryActivate`.
    ActivationResult(ActivationResult),
    /// Typed refusal: the `TryActivate` sender's build ID is not exactly the
    /// helper's. The helper must be upgraded or disabled — this is a refusal,
    /// never permission to activate some other way.
    #[serde(rename_all = "camelCase")]
    BuildMismatch { helper_build_id: String },
    /// Typed refusal: the authenticated caller may not make this request (the
    /// sync agent may only send `TryActivate`).
    CallerNotPermitted,
    /// Typed refusal: the request did not parse — not JSON, an unknown kind,
    /// or a malformed activation body.
    RequestNotUnderstood,
}

impl HelperReply {
    pub fn encode(&self) -> String {
        serde_json::to_string(self).expect("helper reply serializes")
    }

    /// Client-side parse. A reply that does not parse is treated as a
    /// refusal by every caller: do not activate, do not mutate, report and
    /// defer.
    pub fn parse(line: &str) -> Result<Self> {
        let reply: Self = serde_json::from_str(line)?;
        if let HelperReply::Status {
            state, activation, ..
        } = &reply
        {
            let activation_required = matches!(
                state,
                HelperStateName::Activating | HelperStateName::Retiring
            );
            if activation_required != activation.is_some() {
                bail!("Status state {state} carries an invalid activation payload");
            }
        }
        Ok(reply)
    }

    /// One-line human description for reports and logs. Display only —
    /// classification always goes through the typed variants, never through
    /// this text.
    #[allow(dead_code)]
    pub fn summary(&self) -> String {
        match self {
            HelperReply::Status {
                state,
                helper_build_id,
                ..
            } => format!("helper is {state} at build {helper_build_id}"),
            HelperReply::Retired { .. } => {
                "the helper is retired and will never start another activation".to_string()
            }
            HelperReply::Busy { activation } => format!(
                "the helper is running an activation ({} submitted by the {})",
                activation.script_path, activation.client_kind
            ),
            HelperReply::ActivationResult(result) if result.ok => {
                "activation completed".to_string()
            }
            HelperReply::ActivationResult(result) => {
                format!("activation failed (exit code {})", result.code)
            }
            HelperReply::BuildMismatch { helper_build_id } => format!(
                "the installed helper is from a different nixmac build (build {helper_build_id})"
            ),
            HelperReply::CallerNotPermitted => {
                "the helper does not permit this caller to make that request".to_string()
            }
            HelperReply::RequestNotUnderstood => {
                "the helper did not understand the request".to_string()
            }
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

/// A ready-to-send activation body. Opaque on purpose: `activation_request`
/// is the only constructor, so the client's activation entry point cannot be
/// handed a hand-assembled body with a non-canonicalized target.
#[derive(Debug, Clone)]
pub struct ActivationRequest(pub(crate) TryActivateBody);

/// Builds the `TryActivate` body for the current process, with a fresh
/// client-generated request ID. Resolving the path here is a convenience so
/// an obviously wrong target fails before a round trip; the helper
/// canonicalizes and revalidates independently, and treats nothing in this
/// request as trusted beyond the path it re-derives.
pub fn activation_request(activate_path: &Path) -> Result<ActivationRequest> {
    let canonical = canonicalize_activate_path(activate_path)?;

    Ok(ActivationRequest(TryActivateBody {
        request_id: uuid::Uuid::new_v4().to_string(),
        script_path: canonical.to_string_lossy().into_owned(),
    }))
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

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncAgentLaunchConfig {
    pub config_dir: Option<String>,
    pub host_attr: Option<String>,
    pub sync_pull: bool,
    pub unattended_apply: bool,
    pub start_interval_seconds: Option<u32>,
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

    const BUILD_A: &str = "build-a";
    const BUILD_B: &str = "build-b";
    const SCRIPT: &str = "/nix/store/abc-darwin-system/activate";

    fn activation_info(kind: ClientKind) -> ActivationInfo {
        ActivationInfo {
            request_id: "req-1".to_string(),
            script_path: SCRIPT.to_string(),
            client_kind: kind,
        }
    }

    fn try_activate(build_id: &str) -> HelperRequest {
        HelperRequest::TryActivate {
            build_id: build_id.to_string(),
            body: TryActivateBody {
                request_id: "req-1".to_string(),
                script_path: SCRIPT.to_string(),
            },
        }
    }

    // ------------------------------------------------------------------
    // Frozen-surface golden fixtures.
    //
    // The frozen surface is the cross-build control language and nothing
    // else: `Status`, `Retire`, their replies, and the typed refusals. Each
    // fixture below says exactly which bytes may never change. `TryActivate`
    // and its result are explicitly unfrozen and covered by ordinary
    // round-trip tests further down.
    // ------------------------------------------------------------------

    #[test]
    fn frozen_control_requests() {
        // FROZEN SURFACE — these two fixtures may never change. They carry no
        // build ID and no version: they are exactly the requests that must
        // work when the peer is from another build.
        for (request, fixture) in [
            (HelperRequest::Status, r#"{"kind":"status"}"#),
            (HelperRequest::Retire, r#"{"kind":"retire"}"#),
        ] {
            assert_eq!(request.encode(), fixture);
            assert_eq!(HelperRequest::parse(fixture).expect("parses"), request);
        }
    }

    #[test]
    fn frozen_framing_is_one_newline_terminated_json_line() {
        // FROZEN SURFACE — the framing may never change. Every exchange on
        // this socket is one newline-terminated JSON line in each direction,
        // and both sides read exactly one newline-delimited frame. Switching
        // to length-prefixed or multi-line framing would break every
        // cross-build exchange while leaving the shape fixtures above
        // passing, so it is pinned here rather than only in the behavioral
        // socket tests.
        let request = HelperRequest::Status.encode();
        let reply = HelperReply::Retired { activation: None }.encode();

        // Encoders emit exactly one line and never the terminator itself —
        // the caller appends it, so a terminator here would frame two lines.
        for encoded in [&request, &reply] {
            assert!(!encoded.contains('\n'), "encoded {encoded:?} spans lines");
        }

        // What actually goes on the wire, byte for byte.
        assert_eq!(format!("{request}\n"), "{\"kind\":\"status\"}\n");
        assert_eq!(format!("{reply}\n"), "{\"reply\":\"retired\"}\n");
    }

    #[test]
    fn frozen_status_reply_per_state() {
        // FROZEN SURFACE — one fixture per state; none may ever change.
        let cases = [
            (
                HelperReply::Status {
                    state: HelperStateName::Idle,
                    helper_build_id: BUILD_A.to_string(),
                    activation: None,
                },
                format!(r#"{{"reply":"status","state":"idle","helperBuildId":"{BUILD_A}"}}"#),
            ),
            (
                HelperReply::Status {
                    state: HelperStateName::Activating,
                    helper_build_id: BUILD_A.to_string(),
                    activation: Some(activation_info(ClientKind::Gui)),
                },
                format!(
                    r#"{{"reply":"status","state":"activating","helperBuildId":"{BUILD_A}","activation":{{"requestId":"req-1","scriptPath":"{SCRIPT}","clientKind":"gui"}}}}"#
                ),
            ),
            (
                HelperReply::Status {
                    state: HelperStateName::Retiring,
                    helper_build_id: BUILD_A.to_string(),
                    activation: Some(activation_info(ClientKind::SyncAgent)),
                },
                format!(
                    r#"{{"reply":"status","state":"retiring","helperBuildId":"{BUILD_A}","activation":{{"requestId":"req-1","scriptPath":"{SCRIPT}","clientKind":"syncAgent"}}}}"#
                ),
            ),
            (
                HelperReply::Status {
                    state: HelperStateName::Retired,
                    helper_build_id: BUILD_A.to_string(),
                    activation: None,
                },
                format!(r#"{{"reply":"status","state":"retired","helperBuildId":"{BUILD_A}"}}"#),
            ),
        ];

        for (reply, fixture) in cases {
            assert_eq!(reply.encode(), fixture);
            assert_eq!(HelperReply::parse(&fixture).expect("parses"), reply);
        }
    }

    #[test]
    fn frozen_retire_replies_including_busy_with_activation_info() {
        // FROZEN SURFACE — the complete Retire replies; may never change.
        let retired = HelperReply::Retired { activation: None };
        assert_eq!(retired.encode(), r#"{"reply":"retired"}"#);
        assert_eq!(
            HelperReply::parse(r#"{"reply":"retired"}"#).expect("parses"),
            retired
        );

        let busy = HelperReply::Busy {
            activation: activation_info(ClientKind::Gui),
        };
        let busy_fixture = r#"{"reply":"busy","activation":{"requestId":"req-1","scriptPath":"/nix/store/abc-darwin-system/activate","clientKind":"gui"}}"#;
        assert_eq!(busy.encode(), busy_fixture);
        assert_eq!(HelperReply::parse(busy_fixture).expect("parses"), busy);
    }

    #[test]
    fn frozen_typed_refusals() {
        // FROZEN SURFACE — the three typed refusals; may never change.
        let build_mismatch = HelperReply::BuildMismatch {
            helper_build_id: BUILD_B.to_string(),
        };
        let build_mismatch_fixture =
            format!(r#"{{"reply":"buildMismatch","helperBuildId":"{BUILD_B}"}}"#);
        assert_eq!(build_mismatch.encode(), build_mismatch_fixture);
        assert_eq!(
            HelperReply::parse(&build_mismatch_fixture).expect("parses"),
            build_mismatch
        );

        assert_eq!(
            HelperReply::CallerNotPermitted.encode(),
            r#"{"reply":"callerNotPermitted"}"#
        );
        assert_eq!(
            HelperReply::parse(r#"{"reply":"callerNotPermitted"}"#).expect("parses"),
            HelperReply::CallerNotPermitted
        );

        assert_eq!(
            HelperReply::RequestNotUnderstood.encode(),
            r#"{"reply":"requestNotUnderstood"}"#
        );
        assert_eq!(
            HelperReply::parse(r#"{"reply":"requestNotUnderstood"}"#).expect("parses"),
            HelperReply::RequestNotUnderstood
        );
    }

    // ------------------------------------------------------------------
    // Request and reply semantics beyond the golden bytes.
    // ------------------------------------------------------------------

    #[test]
    fn try_activate_round_trips_with_its_build_id_and_body() {
        // Unfrozen: an ordinary round trip, not a byte fixture.
        let request = try_activate(BUILD_A);
        let encoded = request.encode();

        assert_eq!(HelperRequest::parse(&encoded).expect("parses"), request);
        match HelperRequest::parse(&encoded).expect("parses") {
            HelperRequest::TryActivate { build_id, body } => {
                assert_eq!(build_id, BUILD_A);
                assert_eq!(body.script_path, SCRIPT);
            }
            other => panic!("unexpected request: {other:?}"),
        }
    }

    #[test]
    fn an_unknown_kind_is_not_understood() {
        // The kind set is closed forever; anything else is a request no
        // receiver may serve.
        assert!(HelperRequest::parse(r#"{"kind":"selfDestruct"}"#).is_none());
    }

    #[test]
    fn a_control_request_from_another_build_still_reads_as_itself() {
        // Cross-build tolerance in the direction that matters: an older or
        // newer build's Status/Retire — including fields this build knows
        // nothing about — must still be recognized, because these are the
        // requests that discover and retire a helper that is not this build.
        assert_eq!(
            HelperRequest::parse(r#"{"kind":"status","somethingNew":true}"#).expect("parses"),
            HelperRequest::Status
        );
        assert_eq!(
            HelperRequest::parse(r#"{"kind":"retire","somethingNew":{"nested":1}}"#)
                .expect("parses"),
            HelperRequest::Retire
        );
    }

    #[test]
    fn shipped_pre_build_id_wire_shapes_are_not_understood() {
        // The shapes previous releases put on this socket carry no kind
        // field; they must never be misread as a request.
        for line in [
            r#"{"op":"status"}"#,
            r#"{"protocolVersion":2,"op":"status"}"#,
            r#"{"protocolVersion":2,"op":{"activateStorePath":{"activatePath":"/nix/store/abc-darwin-system/activate"}}}"#,
            "not json at all",
            "",
        ] {
            assert!(HelperRequest::parse(line).is_none(), "line: {line:?}");
        }
    }

    #[test]
    fn a_malformed_try_activate_is_not_understood() {
        // A missing body, a body field this build does not honor, and a
        // missing build ID all fail the one parse — there is no partially
        // readable request to act on.
        for line in [
            r#"{"kind":"tryActivate","buildId":"build-a"}"#,
            r#"{"kind":"tryActivate","body":{"requestId":"req-1","scriptPath":"/nix/store/abc-darwin-system/activate"}}"#,
            r#"{"kind":"tryActivate","buildId":"build-a","body":{"requestId":"req-1","scriptPath":"/nix/store/abc-darwin-system/activate","nixPath":"/tmp/attacker-bin"}}"#,
            r#"{"kind":"tryActivate","buildId":"build-a","body":{"somethingElse":1}}"#,
        ] {
            assert!(HelperRequest::parse(line).is_none(), "line: {line:?}");
        }
    }

    #[test]
    fn a_peer_build_id_is_read_whatever_it_contains() {
        // Build IDs are compared, never validated: every string is a readable
        // ID, the empty string included. An empty peer ID is simply unequal to
        // this build's non-empty one — rejecting the request or reply that
        // carries it would instead make the mismatch unreportable.
        for build_id in ["", " ", "0123456", "not-a-commit", "\u{1f600}"] {
            let request = try_activate(build_id);
            assert_eq!(
                HelperRequest::parse(&request.encode()).expect("parses"),
                request
            );

            let status = HelperReply::Status {
                state: HelperStateName::Idle,
                helper_build_id: build_id.to_string(),
                activation: None,
            };
            assert_eq!(
                HelperReply::parse(&status.encode()).expect("parses"),
                status
            );

            let mismatch = HelperReply::BuildMismatch {
                helper_build_id: build_id.to_string(),
            };
            assert_eq!(
                HelperReply::parse(&mismatch.encode()).expect("parses"),
                mismatch
            );
        }
    }

    #[test]
    fn reply_parse_tolerates_unknown_fields_and_rejects_unknown_tags() {
        // Frozen replies from other builds must keep parsing even if a
        // diagnostic field is ever (wrongly) added; an unknown reply tag is
        // an unparseable reply, which every client treats as a refusal.
        let with_extra = format!(
            r#"{{"reply":"status","state":"idle","helperBuildId":"{BUILD_A}","note":"diagnostic"}}"#
        );
        assert!(matches!(
            HelperReply::parse(&with_extra).expect("parses"),
            HelperReply::Status {
                state: HelperStateName::Idle,
                ..
            }
        ));

        assert!(HelperReply::parse(r#"{"reply":"shutdown"}"#).is_err());
        assert!(HelperReply::parse(r#"{"ok":true,"code":0,"stdout":"ready"}"#).is_err());
        assert!(HelperReply::parse("").is_err());
    }

    #[test]
    fn status_reply_rejects_state_activation_mismatches() {
        let impossible = [
            HelperReply::Status {
                state: HelperStateName::Idle,
                helper_build_id: BUILD_A.to_string(),
                activation: Some(activation_info(ClientKind::Gui)),
            },
            HelperReply::Status {
                state: HelperStateName::Activating,
                helper_build_id: BUILD_A.to_string(),
                activation: None,
            },
            HelperReply::Status {
                state: HelperStateName::Retiring,
                helper_build_id: BUILD_A.to_string(),
                activation: None,
            },
            HelperReply::Status {
                state: HelperStateName::Retired,
                helper_build_id: BUILD_A.to_string(),
                activation: Some(activation_info(ClientKind::SyncAgent)),
            },
        ];

        for reply in impossible {
            let wire = reply.encode();
            assert!(
                HelperReply::parse(&wire).is_err(),
                "impossible Status parsed: {wire}"
            );
        }
    }

    #[test]
    fn activation_request_canonicalizes_and_generates_request_ids() {
        // Non-store paths fail before any round trip.
        assert!(activation_request(Path::new("/tmp/result/activate")).is_err());
    }

    // ------------------------------------------------------------------
    // Path validation (unchanged behavior).
    // ------------------------------------------------------------------

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
    fn failure_detail_prefers_error_then_stdout_tail() {
        let failed = |stdout: &str, error: Option<&str>| ActivationResult {
            ok: false,
            code: 1,
            stdout: stdout.to_string(),
            error: error.map(String::from),
        };

        assert_eq!(failed("out", Some("boom")).failure_detail(), "boom");
        // The helper merges activation stderr into stdout, so a plain nonzero
        // exit must still produce a detail.
        assert_eq!(
            failed("activation exploded\n", None).failure_detail(),
            "activation exploded"
        );

        let lines: Vec<String> = (1..=30).map(|n| format!("line {n}")).collect();
        let detail = failed(&lines.join("\n"), None).failure_detail();
        assert!(detail.starts_with("line 11"));
        assert!(detail.ends_with("line 30"));
    }

    #[test]
    fn warnings_extracts_prefixed_stdout_lines() {
        let stdout = format!(
            "activated\n{HELPER_WARNING_PREFIX} failed to update system profile\nplain line"
        );
        let with_warning = ActivationResult {
            ok: true,
            code: 0,
            stdout,
            error: None,
        };

        assert_eq!(
            with_warning.warnings(),
            vec![format!(
                "{HELPER_WARNING_PREFIX} failed to update system profile"
            )]
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
