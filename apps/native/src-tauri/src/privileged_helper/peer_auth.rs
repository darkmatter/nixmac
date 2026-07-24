// Cryptographic peer authentication for the privileged-helper socket.
//
// Identity comes from the kernel audit token (`LOCAL_PEERTOKEN`), which is
// race-free — a pid can be reused between lookup and validation, so the old
// pid → `proc_pidpath` heuristic was open to a TOCTOU swap. Authorization is
// Security-framework dynamic code validation: audit token → `SecCode` for the
// live process → `SecCodeCheckValidity` against a pinned signing requirement.
// Path strings never participate in the decision.
//
// Compiled into the app, the sync agent, and the helper binaries via
// `include!` (like `protocol.rs`), so no inner doc comments here.

use anyhow::{Context, Result, bail};
use std::os::unix::net::UnixStream;

// Marker embedded in client-side daemon-validation failures so callers can
// distinguish "impostor/stale helper at the socket" from "helper not running".
pub const HELPER_VALIDATION_FAILED: &str = "helper at socket failed signature validation";

// Entitlement that marks a binary as an approved helper client; granted to
// the app and sync agent at signing time.
pub const HELPER_CLIENT_ENTITLEMENT: &str = "com.darkmatter.nixmac.helper-client";

pub const APP_CODE_IDENTIFIER: &str = "com.darkmatter.nixmac";
pub const SYNC_AGENT_CODE_IDENTIFIER: &str = "com.darkmatter.nixmac.sync-agent";
pub const HELPER_CODE_IDENTIFIER: &str = "com.darkmatter.nixmac.helper";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequirementMode {
    // Developer ID–anchored chain (release builds).
    Production,
    // Any Apple-issued certificate pinned to the team (Apple Development or
    // Developer ID), so `sign-local-app.sh` and Xcode-style dev certs both
    // pass. Selected only in debug builds.
    Development,
}

pub fn requirement_mode() -> RequirementMode {
    if cfg!(debug_assertions) {
        RequirementMode::Development
    } else {
        RequirementMode::Production
    }
}

// The signing team is injected at build time; without it every peer fails
// validation (fail closed) and unsigned dev builds fall through to the
// interactive osascript path.
pub fn configured_team_id() -> Option<&'static str> {
    option_env!("NIXMAC_TEAM_ID").filter(|team_id| !team_id.trim().is_empty())
}

// Requirement the daemon checks against a connecting client (app or sync
// agent). Pure so requirement construction is unit-testable without Security
// framework calls.
pub fn client_requirement_string(mode: RequirementMode, team_id: &str) -> String {
    // The helper-client entitlement is a restricted custom entitlement: under
    // an Apple Development certificate AMFI refuses to launch a binary that
    // carries it without a provisioning profile granting it, which a free
    // personal team cannot obtain for this App ID. Development mode exists to
    // let Apple Development certs pass, so it drops the entitlement clause; the
    // anchor + team-OU + identifier pins still constrain the client to our own
    // signed app/agent. Production keeps the entitlement requirement.
    let entitlement_clause = match mode {
        RequirementMode::Production => {
            format!(" and entitlement[\"{HELPER_CLIENT_ENTITLEMENT}\"] exists")
        }
        RequirementMode::Development => String::new(),
    };
    format!(
        "{anchor} and certificate leaf[subject.OU] = \"{team_id}\" \
         and (identifier \"{app}\" or identifier \"{agent}\"){entitlement_clause}",
        anchor = anchor_clause(mode),
        app = APP_CODE_IDENTIFIER,
        agent = SYNC_AGENT_CODE_IDENTIFIER,
    )
}

// Requirement the client checks against the daemon before sending a request.
pub fn helper_requirement_string(mode: RequirementMode, team_id: &str) -> String {
    format!(
        "{anchor} and certificate leaf[subject.OU] = \"{team_id}\" \
         and identifier \"{helper}\"",
        anchor = anchor_clause(mode),
        helper = HELPER_CODE_IDENTIFIER,
    )
}

fn anchor_clause(mode: RequirementMode) -> &'static str {
    match mode {
        // Developer ID CA intermediate + Developer ID leaf marker OIDs.
        RequirementMode::Production => {
            "anchor apple generic \
             and certificate 1[field.1.2.840.113635.100.6.2.6] \
             and certificate leaf[field.1.2.840.113635.100.6.1.13]"
        }
        RequirementMode::Development => "anchor apple generic",
    }
}

// Raw kernel audit token (opaque; only Security framework and libbsm may
// interpret it).
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct AuditToken {
    val: [u32; 8],
}

#[derive(Debug, Clone, Copy)]
pub struct PeerIdentity {
    pub euid: u32,
    pub audit_token: AuditToken,
}

#[cfg(target_os = "macos")]
pub fn peer_identity(stream: &UnixStream) -> Result<PeerIdentity> {
    use nix::sys::socket::{getsockopt, sockopt::LocalPeerToken};

    let token = getsockopt(stream, LocalPeerToken).context("failed to read peer audit token")?;
    let token = AuditToken { val: token.val };
    let euid = unsafe { audit_token_to_euid(token) };
    Ok(PeerIdentity {
        euid,
        audit_token: token,
    })
}

#[cfg(not(target_os = "macos"))]
pub fn peer_identity(_stream: &UnixStream) -> Result<PeerIdentity> {
    bail!("peer credential validation is only implemented on macOS")
}

// Daemon-side check: the live peer code object must satisfy the client
// requirement for this build's mode and configured team.
#[cfg(target_os = "macos")]
pub fn validate_client_code(peer: &PeerIdentity) -> Result<()> {
    let team_id = configured_team_id()
        .ok_or_else(|| anyhow::anyhow!("no signing team configured (NIXMAC_TEAM_ID)"))?;
    check_code_validity(
        &peer.audit_token,
        &client_requirement_string(requirement_mode(), team_id),
    )
}

#[cfg(not(target_os = "macos"))]
pub fn validate_client_code(_peer: &PeerIdentity) -> Result<()> {
    bail!("peer code validation is only implemented on macOS")
}

// Client-side reciprocal check, run after connect and before writing the
// request: the process on the other end must be root and must be the signed
// helper — not an impostor squatting on the socket path.
#[cfg(target_os = "macos")]
pub fn validate_helper_peer(stream: &UnixStream) -> Result<()> {
    validate_helper_peer_inner(stream).context(HELPER_VALIDATION_FAILED)
}

#[cfg(target_os = "macos")]
fn validate_helper_peer_inner(stream: &UnixStream) -> Result<()> {
    let peer = peer_identity(stream)?;
    if peer.euid != 0 {
        bail!("helper peer euid {} is not root", peer.euid);
    }
    let team_id = configured_team_id()
        .ok_or_else(|| anyhow::anyhow!("no signing team configured (NIXMAC_TEAM_ID)"))?;
    check_code_validity(
        &peer.audit_token,
        &helper_requirement_string(requirement_mode(), team_id),
    )
}

#[cfg(not(target_os = "macos"))]
pub fn validate_helper_peer(_stream: &UnixStream) -> Result<()> {
    bail!("{HELPER_VALIDATION_FAILED}: only implemented on macOS")
}

#[cfg(target_os = "macos")]
fn check_code_validity(token: &AuditToken, requirement_text: &str) -> Result<()> {
    use core_foundation::base::TCFType;
    use core_foundation::data::CFData;
    use security_framework::os::macos::code_signing::{
        Flags, GuestAttributes, SecCode, SecRequirement,
    };

    let requirement: SecRequirement = requirement_text
        .parse()
        .with_context(|| format!("invalid signing requirement: {requirement_text}"))?;

    let token_bytes: Vec<u8> = token.val.iter().flat_map(|v| v.to_ne_bytes()).collect();
    let token_data = CFData::from_buffer(&token_bytes);
    let mut attributes = GuestAttributes::new();
    attributes.set_audit_token(token_data.as_concrete_TypeRef());

    let code = SecCode::copy_guest_with_attribues(None, &attributes, Flags::NONE)
        .context("failed to resolve peer code object from audit token")?;
    code.check_validity(Flags::NONE, &requirement)
        .context("peer code failed signing-requirement validation")?;
    Ok(())
}

// Uid of the active console user via SCDynamicStoreCopyConsoleUser.
// None at the login window or when nobody owns the console.
#[cfg(target_os = "macos")]
pub fn console_user_uid() -> Option<u32> {
    use core_foundation::base::TCFType;
    use core_foundation::string::CFString;

    let mut uid: libc::uid_t = 0;
    let mut gid: libc::gid_t = 0;
    let name_ref = unsafe { SCDynamicStoreCopyConsoleUser(std::ptr::null(), &mut uid, &mut gid) };
    if name_ref.is_null() {
        return None;
    }
    let name = unsafe { CFString::wrap_under_create_rule(name_ref) }.to_string();
    if name == "loginwindow" || uid == 0 {
        None
    } else {
        Some(uid)
    }
}

#[cfg(not(target_os = "macos"))]
pub fn console_user_uid() -> Option<u32> {
    None
}

// Euid is extracted from the same audit token that SecCode validates, so all
// peer identity derives from one kernel snapshot. LOCAL_PEERCRED would avoid
// this FFI call but introduces a second, separate credential source — a wider
// audit surface for zero memory-safety gain (the call is a by-value read of a
// POD argument, and `audit_token_to_euid` is the non-deprecated accessor).
#[cfg(target_os = "macos")]
#[link(name = "bsm")]
unsafe extern "C" {
    fn audit_token_to_euid(token: AuditToken) -> libc::uid_t;
}

#[cfg(target_os = "macos")]
#[link(name = "SystemConfiguration", kind = "framework")]
unsafe extern "C" {
    fn SCDynamicStoreCopyConsoleUser(
        store: *const std::ffi::c_void,
        uid: *mut libc::uid_t,
        gid: *mut libc::gid_t,
    ) -> core_foundation::string::CFStringRef;
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEAM: &str = "TESTTEAMID";

    #[test]
    fn production_client_requirement_pins_developer_id_chain() {
        let requirement = client_requirement_string(RequirementMode::Production, TEAM);

        assert!(requirement.starts_with("anchor apple generic"));
        assert!(requirement.contains("certificate 1[field.1.2.840.113635.100.6.2.6]"));
        assert!(requirement.contains("certificate leaf[field.1.2.840.113635.100.6.1.13]"));
        assert!(requirement.contains("certificate leaf[subject.OU] = \"TESTTEAMID\""));
        assert!(requirement.contains("identifier \"com.darkmatter.nixmac\""));
        assert!(requirement.contains("identifier \"com.darkmatter.nixmac.sync-agent\""));
        assert!(
            requirement.contains("entitlement[\"com.darkmatter.nixmac.helper-client\"] exists")
        );
    }

    #[test]
    fn development_client_requirement_pins_team_without_entitlement() {
        let requirement = client_requirement_string(RequirementMode::Development, TEAM);

        assert!(requirement.starts_with("anchor apple generic"));
        assert!(!requirement.contains("field.1.2.840.113635.100.6.1.13"));
        assert!(requirement.contains("certificate leaf[subject.OU] = \"TESTTEAMID\""));
        assert!(requirement.contains("identifier \"com.darkmatter.nixmac\""));
        // Development mode must NOT require the restricted helper-client
        // entitlement, or an Apple Development cert could never launch.
        assert!(!requirement.contains("entitlement"));
    }

    #[test]
    fn helper_requirement_pins_helper_identifier_without_entitlement_clause() {
        let requirement = helper_requirement_string(RequirementMode::Production, TEAM);

        assert!(requirement.contains("identifier \"com.darkmatter.nixmac.helper\""));
        assert!(requirement.contains("certificate leaf[subject.OU] = \"TESTTEAMID\""));
        assert!(!requirement.contains("entitlement"));
    }
}
