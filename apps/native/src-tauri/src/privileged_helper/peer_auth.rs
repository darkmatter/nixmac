// Cryptographic peer authentication for the privileged-helper socket.
//
// Identity comes from the kernel audit token (`LOCAL_PEERTOKEN`), which is
// race-free — a pid can be reused between lookup and validation, so the old
// pid → `proc_pidpath` heuristic was open to a TOCTOU swap. Authorization is
// Security-framework dynamic code validation: audit token → `SecCode` for the
// live process → `SecCodeCheckValidity` against a pinned signing requirement.
// Path strings never participate in the decision.
//
// Validation has exactly three results, as distinct types: valid (the pinned
// requirement is satisfied), invalid (the code demonstrably does not satisfy
// it — a completed judgment, even where the platform expresses it as an
// error code), and error (no judgment could be reached). An error is never
// treated as invalid: removal decisions elsewhere hang on that distinction.
//
// Compiled into the app, the sync agent, and the helper binaries via
// `include!` (like `protocol.rs`), so no inner doc comments here.

#[cfg(target_os = "macos")]
use anyhow::Context;
use anyhow::{Result, bail};
// SDK-generated Security.framework status constants; see
// `INVALID_SIGNATURE_STATUSES`. Aliased because the generated names keep their
// C spelling. macOS-only: the crate links Security.framework unconditionally
// and cannot build off Apple.
#[cfg(target_os = "macos")]
use objc2_security as sec;
use serde::{Deserialize, Serialize};
use std::os::unix::net::UnixStream;

// Everything below up to `AuditToken` builds macOS signing requirements; on
// other targets only the `bail!` stubs are reachable, so mute dead-code there
// while keeping macOS builds strict.

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const APP_CODE_IDENTIFIER: &str = "com.darkmatter.nixmac";
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const SYNC_AGENT_CODE_IDENTIFIER: &str = "com.darkmatter.nixmac.sync-agent";
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const HELPER_CODE_IDENTIFIER: &str = "com.darkmatter.nixmac.helper";

// Which pinned per-binary requirement a validated client satisfied. Derived
// from the validated code object only — nothing a peer sends can influence
// it. Serialized inside the protocol's activation info (X), hence the wire
// names.
//
// These values ride inside X, which is part of the frozen `Status` and
// `Busy(X)` replies, so the wire name of an existing kind may NEVER change or
// be removed: the load-bearing upgrade direction is a new GUI reading the
// installed old helper's replies, and a renamed value breaks exactly that.
//
// Adding a kind is weaker but not free. It only affects the reverse direction
// — an older client reading a newer helper — where every reader is a
// non-actor: an old client's `TryActivate` is refused as a build mismatch
// before any `Busy(X)` could be sent, the sync agent may send nothing else at
// all, and an old GUI is displaced and forbidden from mutating anyway. Each
// would report an unparseable reply and defer. So a third kind degrades old
// observers rather than deadlocking an upgrade; add one only as a deliberate
// decision, knowing no test will fail when you do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClientKind {
    Gui,
    SyncAgent,
}

impl std::fmt::Display for ClientKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            ClientKind::Gui => "app",
            ClientKind::SyncAgent => "sync agent",
        })
    }
}

// One signature validation's outcome. `Invalid` is a completed judgment
// (unsigned, ad-hoc, wrong team or identifier — the answer is no); `Error`
// means no judgment could be reached (dead peer, resource exhaustion,
// evaluation failure) and is never treated as invalid.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub enum SignatureValidation {
    Valid,
    Invalid(String),
    Error(String),
}

// The helper's classification of a connecting client against the per-binary
// pinned requirements, evaluated separately; the requirement that matched is
// the client's kind.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub enum ClientValidation {
    Valid(ClientKind),
    Invalid(String),
    Error(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub enum RequirementMode {
    // Developer ID–anchored chain (release builds).
    Production,
    // Any Apple-issued certificate pinned to the team (Apple Development or
    // Developer ID), so `sign-local-app.sh` and Xcode-style dev certs both
    // pass. Selected only in debug builds.
    Development,
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn requirement_mode() -> RequirementMode {
    if cfg!(debug_assertions) {
        RequirementMode::Development
    } else {
        RequirementMode::Production
    }
}

// The signing team is injected at build time; without it no judgment can be
// reached (an error, fail closed) and unsigned dev builds fall through to the
// interactive osascript path.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn configured_team_id() -> Option<&'static str> {
    option_env!("NIXMAC_TEAM_ID").filter(|team_id| !team_id.trim().is_empty())
}

// Per-binary pinned requirements. Each pins IDENTITY only — anchor, signing
// team, and that binary's designated identifier — never a hash, version, or
// anything release-specific: every requirement must be satisfied by every
// past and future release of its binary, because cross-release validation is
// what every upgrade depends on. The GUI and sync-agent requirements are
// mutually exclusive by construction (each pins its own identifier), so the
// one that matches is the client's kind.
//
// Deliberately no `entitlement[…] exists` clause: a custom entitlement is a
// restricted entitlement, and AMFI refuses to spawn a binary carrying one
// without a provisioning profile granting it — under any certificate type,
// Developer ID included, and Developer ID distribution cannot obtain such a
// profile. Adding one here would require shipping an app that cannot launch,
// and it would prove nothing extra: the anchor, team OU, and identifier pins
// below already mean only our own signed binaries can match.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn gui_client_requirement_string(mode: RequirementMode, team_id: &str) -> String {
    identity_requirement(mode, team_id, APP_CODE_IDENTIFIER)
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn sync_agent_client_requirement_string(mode: RequirementMode, team_id: &str) -> String {
    identity_requirement(mode, team_id, SYNC_AGENT_CODE_IDENTIFIER)
}

// Requirement the client checks against the daemon before sending a request.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn helper_requirement_string(mode: RequirementMode, team_id: &str) -> String {
    identity_requirement(mode, team_id, HELPER_CODE_IDENTIFIER)
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn identity_requirement(mode: RequirementMode, team_id: &str, identifier: &str) -> String {
    format!(
        "{anchor} and certificate leaf[subject.OU] = \"{team_id}\" \
         and identifier \"{identifier}\"",
        anchor = anchor_clause(mode),
    )
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
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

// Security-framework validation statuses that are completed negative
// judgments rather than failures to reach a judgment. Every value is the
// `objc2-security` constant generated from the SDK's Security.framework
// headers (`CSCommon.h`, `SecBase.h`, `cssmerr.h`), so a name that does not
// exist is a build failure rather than a silently mis-transcribed number.
//
// Membership is still ours to maintain, and stays explicit: treating a new or
// ambiguous status as invalid could authorize removal of a helper whose
// identity was never actually judged.
//
// macOS-only, following the SDK crate that supplies the constants. Nothing off
// Apple can produce these statuses — only `validate_signature`'s macOS arm
// consults the table — so the tests over it are macOS-only too and run on the
// macOS CI runner.
#[cfg(target_os = "macos")]
const INVALID_SIGNATURE_STATUSES: &[i32] = &[
    // The code has no acceptable signature or does not satisfy the pinned
    // requirement (unsigned, ad-hoc, wrong team, or wrong identifier).
    sec::errSecCSGuestInvalid,
    sec::errSecCSUnsigned,
    sec::errSecCSSignatureFailed,
    sec::errSecCSBadDictionaryFormat,
    sec::errSecCSReqInvalid,
    sec::errSecCSReqFailed,
    sec::errSecCSBadObjectFormat,
    sec::errSecCSHostReject,
    sec::errSecCSSignatureInvalid,
    sec::errSecCSStaticCodeChanged,
    sec::errSecCSInfoPlistFailed,
    sec::errSecCSNoMainExecutable,
    sec::errSecCSBadBundleFormat,
    sec::errSecCSBadMainExecutable,
    sec::errSecCSInvalidPlatform,
    sec::errSecCSInvalidTeamIdentifier,
    sec::errSecCSBadTeamIdentifier,
    sec::errSecCSSignatureUntrusted,
    sec::errSecMultipleExecSegments,
    sec::errSecCSInvalidEntitlements,
    sec::errSecCSInvalidRuntimeVersion,
    sec::errSecCSRevokedNotarization,
    // A seal or nested component was checked and demonstrably failed. Dynamic
    // validation currently checks only identity-bearing sealed components,
    // but these remain negative judgments if Security returns them.
    sec::errSecCSResourcesNotSealed,
    sec::errSecCSResourcesNotFound,
    sec::errSecCSResourcesInvalid,
    sec::errSecCSBadResource,
    sec::errSecCSResourceRulesInvalid,
    sec::errSecCSResourceDirectoryFailed,
    sec::errSecCSUnsignedNestedCode,
    sec::errSecCSBadNestedCode,
    sec::errSecCSResourceNotSupported,
    sec::errSecCSRegularFile,
    sec::errSecCSUnsealedAppRoot,
    sec::errSecCSWeakResourceRules,
    sec::errSecCSDSStoreSymlink,
    sec::errSecCSAmbiguousBundleFormat,
    sec::errSecCSBadFrameworkVersion,
    sec::errSecCSUnsealedFrameworkRoot,
    sec::errSecCSWeakResourceEnvelope,
    sec::errSecCSInvalidSymlink,
    sec::errSecCSInvalidAssociatedFileData,
    // Certificate trust reached a negative conclusion. These may surface as
    // either legacy CSSM or modern Security.framework statuses.
    sec::CSSMERR_TP_CERT_EXPIRED,
    sec::CSSMERR_TP_CERT_REVOKED,
    sec::CSSMERR_TP_NOT_TRUSTED,
    sec::errSecCertificateExpired,
    sec::errSecCertificateRevoked,
    sec::errSecNotTrusted,
];

// The explicit platform mapping behind the valid/invalid/error trichotomy.
// A status in the table means validation completed and the peer did not
// satisfy the pinned identity requirement. Everything else remains an error:
// the peer may have died, resources may be exhausted, the verifier may be
// unable to read the code, or the platform may have produced a status whose
// semantics this build does not know well enough to authorize removal.
#[cfg(target_os = "macos")]
pub fn signature_judgment_completed(status: i32) -> bool {
    INVALID_SIGNATURE_STATUSES.contains(&status)
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
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
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

// Daemon-side classification: the live peer code object is evaluated against
// each per-binary pinned client requirement separately; the one that matches
// is the client's kind. Invalid only when every evaluation completed its
// judgment; any judgment-preventing failure makes the whole classification
// an error.
#[cfg(target_os = "macos")]
pub fn classify_client(peer: &PeerIdentity) -> ClientValidation {
    let Some(team_id) = configured_team_id() else {
        return ClientValidation::Error("no signing team configured (NIXMAC_TEAM_ID)".to_string());
    };
    let mode = requirement_mode();
    let mut failures = Vec::new();
    for (kind, requirement) in [
        (
            ClientKind::Gui,
            gui_client_requirement_string(mode, team_id),
        ),
        (
            ClientKind::SyncAgent,
            sync_agent_client_requirement_string(mode, team_id),
        ),
    ] {
        match validate_signature(&peer.audit_token, &requirement) {
            SignatureValidation::Valid => return ClientValidation::Valid(kind),
            SignatureValidation::Invalid(detail) => failures.push((kind, detail, true)),
            SignatureValidation::Error(detail) => failures.push((kind, detail, false)),
        }
    }
    let judgment_completed = failures.iter().all(|(_, _, completed)| *completed);
    let detail = failures
        .iter()
        .map(|(kind, detail, _)| format!("{kind}: {detail}"))
        .collect::<Vec<_>>()
        .join("; ");
    if judgment_completed {
        ClientValidation::Invalid(detail)
    } else {
        ClientValidation::Error(detail)
    }
}

#[cfg(not(target_os = "macos"))]
pub fn classify_client(_peer: &PeerIdentity) -> ClientValidation {
    ClientValidation::Error("peer code validation is only implemented on macOS".to_string())
}

// Client-side assessment of whatever answers on the helper socket: the
// peer's euid plus the trichotomous validation against the pinned helper
// requirement. `Err` means the peer's identity could not even be read — a
// judgment-preventing failure, so callers treat it as the error class.
#[cfg(target_os = "macos")]
pub fn assess_helper_peer(stream: &UnixStream) -> Result<(u32, SignatureValidation)> {
    let peer = peer_identity(stream)?;
    let Some(team_id) = configured_team_id() else {
        return Ok((
            peer.euid,
            SignatureValidation::Error("no signing team configured (NIXMAC_TEAM_ID)".to_string()),
        ));
    };
    let requirement = helper_requirement_string(requirement_mode(), team_id);
    Ok((
        peer.euid,
        validate_signature(&peer.audit_token, &requirement),
    ))
}

#[cfg(not(target_os = "macos"))]
pub fn assess_helper_peer(_stream: &UnixStream) -> Result<(u32, SignatureValidation)> {
    bail!("peer code validation is only implemented on macOS")
}

// Client-side authenticated gate, run after connect and before writing any
// request: the process on the other end must be root and must validate as
// the signed helper — not an impostor squatting on the socket path.
pub fn validate_helper_peer(stream: &UnixStream) -> Result<()> {
    let (euid, validation) = assess_helper_peer(stream)?;
    if euid != 0 {
        bail!("helper peer euid {euid} is not root");
    }
    match validation {
        SignatureValidation::Valid => Ok(()),
        SignatureValidation::Invalid(detail) => {
            bail!("helper at socket failed signature validation: {detail}")
        }
        SignatureValidation::Error(detail) => {
            bail!("helper signature validation could not complete: {detail}")
        }
    }
}

// One signature validation with the explicit trichotomy mapping applied.
#[cfg(target_os = "macos")]
pub fn validate_signature(token: &AuditToken, requirement_text: &str) -> SignatureValidation {
    use core_foundation::base::TCFType;
    use core_foundation::data::CFData;
    use security_framework::os::macos::code_signing::{
        Flags, GuestAttributes, SecCode, SecRequirement,
    };

    let requirement: SecRequirement = match requirement_text.parse() {
        Ok(requirement) => requirement,
        Err(error) => {
            return SignatureValidation::Error(format!(
                "invalid signing requirement {requirement_text}: {error}"
            ));
        }
    };

    let token_bytes: Vec<u8> = token.val.iter().flat_map(|v| v.to_ne_bytes()).collect();
    let token_data = CFData::from_buffer(&token_bytes);
    let mut attributes = GuestAttributes::new();
    attributes.set_audit_token(token_data.as_concrete_TypeRef());

    // A peer whose code object cannot be resolved (it died, or the system is
    // out of resources) prevented the judgment — an error, never invalid.
    let code = match SecCode::copy_guest_with_attribues(None, &attributes, Flags::NONE) {
        Ok(code) => code,
        Err(error) => {
            return SignatureValidation::Error(format!(
                "failed to resolve peer code object from audit token: {error}"
            ));
        }
    };
    match code.check_validity(Flags::NONE, &requirement) {
        Ok(()) => SignatureValidation::Valid,
        Err(error) => {
            let status = error.code();
            if signature_judgment_completed(status) {
                SignatureValidation::Invalid(format!(
                    "peer code failed signing-requirement validation ({status})"
                ))
            } else {
                SignatureValidation::Error(format!(
                    "signing-requirement evaluation failed ({status}): {error}"
                ))
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
pub fn validate_signature(_token: &AuditToken, _requirement_text: &str) -> SignatureValidation {
    SignatureValidation::Error("peer code validation is only implemented on macOS".to_string())
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
    fn production_requirements_pin_developer_id_chain() {
        // Pinned by equality, not by fragments: this is the other half of
        // `requirements_pin_identity_only_never_a_hash_or_version`, which
        // builds its expected string from this same clause and so cannot
        // catch anything added inside it.
        assert_eq!(
            anchor_clause(RequirementMode::Production),
            "anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] and certificate leaf[field.1.2.840.113635.100.6.1.13]"
        );

        for requirement in [
            gui_client_requirement_string(RequirementMode::Production, TEAM),
            sync_agent_client_requirement_string(RequirementMode::Production, TEAM),
            helper_requirement_string(RequirementMode::Production, TEAM),
        ] {
            assert!(requirement.starts_with("anchor apple generic"));
            assert!(requirement.contains("certificate 1[field.1.2.840.113635.100.6.2.6]"));
            assert!(requirement.contains("certificate leaf[field.1.2.840.113635.100.6.1.13]"));
            assert!(requirement.contains("certificate leaf[subject.OU] = \"TESTTEAMID\""));
        }
    }

    #[test]
    fn development_requirements_pin_team_without_developer_id_markers() {
        assert_eq!(
            anchor_clause(RequirementMode::Development),
            "anchor apple generic"
        );

        let requirement = gui_client_requirement_string(RequirementMode::Development, TEAM);

        assert!(requirement.starts_with("anchor apple generic"));
        assert!(!requirement.contains("field.1.2.840.113635.100.6.2.6"));
        assert!(!requirement.contains("field.1.2.840.113635.100.6.1.13"));
        assert!(requirement.contains("certificate leaf[subject.OU] = \"TESTTEAMID\""));
    }

    #[test]
    fn each_client_requirement_pins_exactly_its_own_identifier() {
        // Mutually exclusive by construction: the requirement that matches
        // IS the client's kind, so neither may accept the other binary.
        let gui = gui_client_requirement_string(RequirementMode::Production, TEAM);
        assert!(gui.contains("identifier \"com.darkmatter.nixmac\""));
        assert!(!gui.contains(SYNC_AGENT_CODE_IDENTIFIER));

        let agent = sync_agent_client_requirement_string(RequirementMode::Production, TEAM);
        assert!(agent.contains("identifier \"com.darkmatter.nixmac.sync-agent\""));

        let helper = helper_requirement_string(RequirementMode::Production, TEAM);
        assert!(helper.contains("identifier \"com.darkmatter.nixmac.helper\""));
        assert!(!helper.contains(SYNC_AGENT_CODE_IDENTIFIER));
    }

    // macOS-only for its second half, which reads the SDK status constants.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_nixmac_binary_of_the_wrong_kind_is_invalid_not_an_error() {
        // The two halves that compose this judgment, stated together because
        // the conclusion is what the legacy classification depends on:
        //
        // 1. Each requirement pins only its own binary's identifier, so a
        //    genuine nixmac binary evaluated against another kind's
        //    requirement does not satisfy it...
        let gui = gui_client_requirement_string(RequirementMode::Production, TEAM);
        let agent = sync_agent_client_requirement_string(RequirementMode::Production, TEAM);
        let helper = helper_requirement_string(RequirementMode::Production, TEAM);
        assert!(!gui.contains(SYNC_AGENT_CODE_IDENTIFIER));
        assert!(!gui.contains(HELPER_CODE_IDENTIFIER));
        assert!(!agent.contains(&format!("identifier \"{APP_CODE_IDENTIFIER}\"")));
        assert!(!agent.contains(HELPER_CODE_IDENTIFIER));
        assert!(!helper.contains(SYNC_AGENT_CODE_IDENTIFIER));

        // 2. ...and the platform reports that non-satisfaction as
        //    errSecCSReqFailed, which is a completed judgment. So the answer
        //    is "no", never "could not tell" — an error would wrongly select
        //    nothing where invalid selects the legacy removal path.
        assert!(signature_judgment_completed(sec::errSecCSReqFailed));
    }

    #[test]
    fn requirements_pin_identity_only_never_a_hash_or_version() {
        // A hash/version/release/build-ID constraint would make a genuine
        // older or newer nixmac binary fail validation — new GUIs would
        // classify old helpers as legacy and direct-kill them. Identity only,
        // forever.
        //
        // Asserted as exact equality rather than a forbidden-substring list:
        // any clause added here fails, including one nobody thought to name.
        // The expected string reuses `anchor_clause`, so this test says only
        // that nothing but anchor, team, and identifier is present — the two
        // tests above pin the anchor's own content by equality, which is what
        // closes the gap.
        for mode in [RequirementMode::Production, RequirementMode::Development] {
            let anchor = anchor_clause(mode);
            for (requirement, identifier) in [
                (
                    gui_client_requirement_string(mode, TEAM),
                    APP_CODE_IDENTIFIER,
                ),
                (
                    sync_agent_client_requirement_string(mode, TEAM),
                    SYNC_AGENT_CODE_IDENTIFIER,
                ),
                (
                    helper_requirement_string(mode, TEAM),
                    HELPER_CODE_IDENTIFIER,
                ),
            ] {
                assert_eq!(
                    requirement,
                    format!(
                        "{anchor} and certificate leaf[subject.OU] = \"{TEAM}\" and identifier \"{identifier}\""
                    )
                );
            }
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn invalid_classified_platform_codes_are_completed_judgments() {
        // The explicit mapping covers the contract's named identity failures
        // and each broader completed-negative category Security can report.
        // Named via `stringify!` so a failure reports which status, without
        // restating the name as a string literal beside the constant.
        macro_rules! assert_completed_judgment {
            ($($status:path),+ $(,)?) => {
                $(assert!(
                    signature_judgment_completed($status),
                    concat!(stringify!($status), " must be invalid"),
                );)+
            };
        }
        assert_completed_judgment!(
            sec::errSecCSUnsigned,
            sec::errSecCSSignatureFailed,
            sec::errSecCSReqFailed,
            sec::errSecCSGuestInvalid,
            sec::errSecCSResourcesInvalid,
            sec::errSecCSInfoPlistFailed,
            sec::errSecCSBadNestedCode,
            sec::errSecCSSignatureUntrusted,
            sec::errSecCSRevokedNotarization,
            sec::CSSMERR_TP_CERT_REVOKED,
            sec::errSecCertificateRevoked,
        );

        // Every entry in the maintained table is intentionally classified as
        // a completed judgment. This catches a future predicate rewrite that
        // accidentally drops one of the SDK-backed cases.
        for status in INVALID_SIGNATURE_STATUSES {
            assert!(signature_judgment_completed(*status), "status {status}");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn other_statuses_are_judgment_preventing_errors() {
        // Anything not in the explicit invalid set prevented the judgment:
        // an error, never invalid (an error must never select removal).
        for status in [
            0,
            -1,
            // memFullErr (resource exhaustion) lives in MacTypes.h, outside the
            // Security headers, so it has no generated constant.
            -108,
            sec::errSecCSNoSuchCode,             // the peer is gone
            sec::errSecCSSignatureNotVerifiable, // verifier could not read code
            sec::errSecCSInternalError,
            sec::errSecCSDBAccess,
            sec::errSecCSCancelled,
            i32::MIN,
        ] {
            assert!(!signature_judgment_completed(status), "status {status}");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn this_test_binary_classifies_as_invalid_not_error() {
        // The test binary is unsigned (or ad-hoc signed on Apple silicon):
        // either way the judgment completes with "no". Landing in Error here
        // would break the trichotomy — a merely-unsigned peer must be a
        // completed judgment.
        let (stream, _other_end) = UnixStream::pair().expect("socketpair");
        let peer = peer_identity(&stream).expect("peer identity");

        match classify_client(&peer) {
            ClientValidation::Invalid(_) => {}
            other => panic!("expected Invalid, got {other:?}"),
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn assess_helper_peer_reports_euid_and_a_completed_judgment() {
        // A socketpair peer is this (non-root, unsigned/ad-hoc) process: the
        // assessment must carry the real euid and an Invalid judgment — the
        // shape the legacy-vs-error distinction is built from.
        let (stream, _other_end) = UnixStream::pair().expect("socketpair");

        let (euid, validation) = assess_helper_peer(&stream).expect("assessment");

        assert_eq!(euid, nix::unistd::geteuid().as_raw());
        assert!(matches!(validation, SignatureValidation::Invalid(_)));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn validate_helper_peer_rejects_this_non_root_test_process() {
        let (stream, _other_end) = UnixStream::pair().expect("socketpair");

        assert!(validate_helper_peer(&stream).is_err());
    }
}
