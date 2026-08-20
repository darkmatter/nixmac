use crate::privileged_helper::peer_auth;
use crate::privileged_helper::protocol::{
    ActivationRequest, BUILD_ID, HELPER_SOCKET_PATH, HelperReply, HelperRequest,
};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;

const CLIENT_TIMEOUT: Duration = Duration::from_secs(30);
/// The one generous bound in this client, and deliberately not one of the short
/// leashes above: an activation legitimately runs for many minutes, so nothing
/// shorter can be put here without turning ordinary long applies into lost
/// results. Half an hour is the accepted ceiling. An activation still running
/// when it expires is reported as an unknown outcome by an apply and as a
/// deferral by the sync agent — neither compensates for it, and the activation
/// itself keeps running. Do not reuse this on `Status`, and do not shorten it
/// to match the probe.
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Status probes back the permissions UI; a wedged helper must not stall a
/// permissions refresh, so they get a short leash instead of CLIENT_TIMEOUT.
const STATUS_PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// How an absence is established: this many failed connection attempts, this
/// far apart. A single failed connect is not "no helper" — a crashed helper
/// sits dark for launchd's ~10 s relaunch throttle, and a freshly registered
/// one takes a moment to bind — so the retry exists to keep a transient from
/// being read as a dead registration and churning an unregister/register
/// cycle (with its possible re-approval prompt). That is all it protects:
/// with activations running in the detached runner, a wrong "absent" can no
/// longer interrupt anything.
const ABSENCE_ATTEMPTS: u32 = 3;
const ABSENCE_ATTEMPT_INTERVAL: Duration = Duration::from_millis(2_500);

/// Why one exchange with the helper produced no usable reply. Typed so every
/// caller decides from structure, never from display text. The
/// close-before-reply case is its own variant because it means something
/// specific: the helper (or whatever holds the socket) declined this client
/// before speaking — every caller treats it as "stop and re-observe".
#[derive(Debug, thiserror::Error)]
pub enum HelperClientError {
    /// The connection could not be established at all.
    #[error("failed to connect to {HELPER_SOCKET_PATH}: {0}")]
    Unreachable(std::io::Error),
    /// Whatever answers the socket failed the helper signature validation
    /// (or was not root); no request bytes were sent to it.
    #[error("helper peer failed authentication: {0:#}")]
    AuthenticationFailed(anyhow::Error),
    /// The peer closed the connection before any reply. A conforming helper
    /// uses this for pre-authentication refusal or a connection dropped at
    /// capacity, but after a `TryActivate` write the client cannot exclude a
    /// helper crash after dispatch; callers must treat that outcome as
    /// unknown rather than automatically compensating.
    #[error("the helper closed the connection before replying")]
    ClosedBeforeReply,
    /// The reply did not arrive or could not be read (timeout included);
    /// ambiguous — the request may or may not have been acted on.
    #[error("helper connection failed mid-exchange: {0}")]
    Io(std::io::Error),
    /// A reply arrived but does not parse as any known reply shape. Treated
    /// as a refusal everywhere: do not activate, do not mutate.
    #[error("the helper sent a reply this build cannot parse: {0}")]
    UnparseableReply(String),
}

/// What answered the helper socket, judged before any protocol bytes crossed
/// it.
///
/// Reconciliation needs the three-way split: a **root** peer whose validation
/// completed with a "no" is the pre-contract or tampered helper, which may be
/// removed without being asked anything, while a validation that could not
/// reach a judgment — or a peer that is not root — authorizes nothing at all.
#[derive(Debug)]
pub enum AssessedExchange {
    /// Root, and the pinned helper requirement is satisfied. The reply came
    /// from the signed helper.
    Answered(HelperReply),
    /// Root, and validation completed with a "no": unsigned, ad-hoc-signed, or
    /// the wrong identity. Not one byte was written to it, and none ever is.
    RootUnverifiable(String),
    /// Nothing may be concluded — a peer that is not root, or a validation that
    /// reached no judgment. No bytes were written.
    Unidentified(String),
}

/// Whether anything is listening on the helper socket, over the absence
/// window above. Pure observation: no protocol bytes are written, which is
/// what makes it safe to point at a helper of any build.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ListenerObservation {
    /// Every attempt over the window failed with "nothing there": the socket
    /// is missing or refuses connections.
    PositivelyAbsent,
    /// A connection was accepted; something is listening.
    Listening,
    /// An attempt failed in a way that is not evidence of absence (a
    /// timeout, permissions, an unclassifiable error). Nothing established.
    Ambiguous(String),
}

/// Establishes whether the helper socket has a listener, retrying over the
/// absence window. `wait` is injected so tests pay nothing for the spacing.
pub fn observe_listener() -> ListenerObservation {
    observe_listener_with(std::path::Path::new(HELPER_SOCKET_PATH), |interval| {
        std::thread::sleep(interval)
    })
}

fn observe_listener_with(
    socket: &std::path::Path,
    mut wait: impl FnMut(Duration),
) -> ListenerObservation {
    for attempt in 0..ABSENCE_ATTEMPTS {
        if attempt > 0 {
            wait(ABSENCE_ATTEMPT_INTERVAL);
        }
        match UnixStream::connect(socket) {
            // Dropped immediately: connecting writes no protocol bytes, and
            // the helper closes unauthenticated or over-cap connections on
            // its own.
            Ok(_stream) => return ListenerObservation::Listening,
            Err(error) => match error.kind() {
                // The two errors that mean "nothing is listening":
                // no socket file, or nothing accepting on it.
                std::io::ErrorKind::NotFound | std::io::ErrorKind::ConnectionRefused => {}
                _ => return ListenerObservation::Ambiguous(error.to_string()),
            },
        }
    }
    ListenerObservation::PositivelyAbsent
}

/// Whether the socket path exists. Diagnostic only — it proves nothing about a
/// helper, which is why nothing in the app reads it: the sync agent's no-config
/// mode prints it, and every decision comes from an authenticated exchange or
/// from [`observe_listener`].
#[allow(dead_code)] // Used by the sync agent binary this module is shared into.
pub fn socket_available() -> bool {
    std::path::Path::new(HELPER_SOCKET_PATH).exists()
}

fn connect(read_timeout: Duration) -> Result<UnixStream, HelperClientError> {
    let stream = UnixStream::connect(HELPER_SOCKET_PATH).map_err(HelperClientError::Unreachable)?;
    stream
        .set_read_timeout(Some(read_timeout))
        .map_err(HelperClientError::Io)?;
    stream
        .set_write_timeout(Some(CLIENT_TIMEOUT))
        .map_err(HelperClientError::Io)?;
    Ok(stream)
}

fn exchange(
    request: &HelperRequest,
    read_timeout: Duration,
) -> Result<HelperReply, HelperClientError> {
    let stream = connect(read_timeout)?;

    // Reciprocal check: whatever answers on the socket must be the signed
    // root helper before this process sends it anything.
    peer_auth::validate_helper_peer(&stream).map_err(HelperClientError::AuthenticationFailed)?;

    exchange_on(stream, request)
}

/// [`exchange`] keeping the peer assessment instead of flattening it, and
/// writing a request only to an authenticated peer.
///
/// The three-way judgment is the whole difference: what may be done about a
/// helper that cannot be talked to depends on whether validation said "no" or
/// said nothing.
fn assessed_exchange(
    request: &HelperRequest,
    read_timeout: Duration,
) -> Result<AssessedExchange, HelperClientError> {
    let stream = connect(read_timeout)?;
    let (euid, validation) =
        peer_auth::assess_helper_peer(&stream).map_err(HelperClientError::AuthenticationFailed)?;

    match peer_verdict(euid, validation) {
        PeerVerdict::Authenticated => exchange_on(stream, request).map(AssessedExchange::Answered),
        PeerVerdict::NotAuthenticated(assessment) => Ok(assessment),
    }
}

/// Whether a request may be written to this peer, or what the peer is instead.
enum PeerVerdict {
    Authenticated,
    NotAuthenticated(AssessedExchange),
}

/// The three-way judgment, as an allowlist: one combination authenticates a
/// peer and every other one ends the exchange before a byte is written.
fn peer_verdict(euid: u32, validation: peer_auth::SignatureValidation) -> PeerVerdict {
    // A peer that is not root is unidentified whatever its signature says. The
    // helper binds its socket inside a root-owned directory, so anything else
    // holding that path is broken permissions or an impostor, and no decision
    // about terminating a helper may be taken from it.
    if euid != 0 {
        return PeerVerdict::NotAuthenticated(AssessedExchange::Unidentified(format!(
            "the process answering {HELPER_SOCKET_PATH} runs as uid {euid}, not root"
        )));
    }
    match validation {
        peer_auth::SignatureValidation::Valid => PeerVerdict::Authenticated,
        // A completed "no" — and the only thing that is one.
        peer_auth::SignatureValidation::Invalid(detail) => {
            PeerVerdict::NotAuthenticated(AssessedExchange::RootUnverifiable(detail))
        }
        // No judgment was reached, which is never the same as a "no".
        peer_auth::SignatureValidation::Error(detail) => {
            PeerVerdict::NotAuthenticated(AssessedExchange::Unidentified(detail))
        }
    }
}

/// The post-authentication half of one exchange: send exactly one request,
/// read exactly one reply. The helper closes the connection after its reply;
/// dropping the stream here does the same from this end.
fn exchange_on(
    stream: UnixStream,
    request: &HelperRequest,
) -> Result<HelperReply, HelperClientError> {
    let mut line = request.encode();
    line.push('\n');
    // A write failure on a freshly closed connection is the helper declining
    // this client before any bytes — the same signal as an empty read.
    (&stream)
        .write_all(line.as_bytes())
        .and_then(|()| (&stream).flush())
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::BrokenPipe | std::io::ErrorKind::ConnectionReset => {
                HelperClientError::ClosedBeforeReply
            }
            _ => HelperClientError::Io(error),
        })?;

    let mut reply_line = String::new();
    let bytes_read =
        BufReader::new(&stream)
            .read_line(&mut reply_line)
            .map_err(|error| match error.kind() {
                std::io::ErrorKind::ConnectionReset => HelperClientError::ClosedBeforeReply,
                _ => HelperClientError::Io(error),
            })?;
    // Nothing at all came back: the peer closed before replying. Every caller
    // treats this as stop-and-re-observe — it is the same signal a helper at
    // its connection cap sends, deliberately indistinguishable from an
    // authentication refusal.
    if bytes_read == 0 {
        return Err(HelperClientError::ClosedBeforeReply);
    }

    HelperReply::parse(&reply_line)
        .map_err(|error| HelperClientError::UnparseableReply(format!("{error:#}")))
}

/// Sends `Status`, keeping the peer assessment. Reconciliation's discovery
/// exchange: it works against a helper of any build, and what it may do about
/// one it cannot talk to depends on which way the assessment went.
pub fn assessed_status() -> Result<AssessedExchange, HelperClientError> {
    assessed_exchange(&HelperRequest::Status, STATUS_PROBE_TIMEOUT)
}

/// Dispatches `TryActivate`, stamped with this build's ID — the helper admits
/// it only if that ID is exactly its own. `ActivationRequest` is only
/// constructible through `protocol::activation_request`, so this entry point
/// cannot be handed a hand-assembled body with a non-canonicalized target. The
/// reply arrives on the same connection when the activation completes.
pub fn activate_store_path(request: &ActivationRequest) -> Result<HelperReply, HelperClientError> {
    exchange(
        &HelperRequest::TryActivate {
            build_id: BUILD_ID.to_string(),
            body: request.0.clone(),
        },
        ACTIVATION_TIMEOUT,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::net::UnixListener;

    #[test]
    fn a_missing_socket_is_positively_absent_after_the_full_window() {
        let dir = tempfile::tempdir().expect("tempdir");
        let mut waits = Vec::new();
        let observation = observe_listener_with(&dir.path().join("no-such.sock"), |interval| {
            waits.push(interval)
        });

        assert_eq!(observation, ListenerObservation::PositivelyAbsent);
        // Every attempt after the first is spaced by the interval; a single
        // failed connect must never conclude absence.
        assert_eq!(waits.len(), (ABSENCE_ATTEMPTS - 1) as usize);
        assert!(waits.iter().all(|wait| *wait == ABSENCE_ATTEMPT_INTERVAL));
    }

    #[test]
    fn a_listening_socket_is_seen_on_the_first_attempt() {
        let dir = tempfile::tempdir().expect("tempdir");
        let socket = dir.path().join("helper.sock");
        let _listener = UnixListener::bind(&socket).expect("bind");

        let observation = observe_listener_with(&socket, |_| panic!("no wait needed"));

        assert_eq!(observation, ListenerObservation::Listening);
    }

    #[test]
    fn a_listener_appearing_mid_window_ends_the_probe_as_listening() {
        let dir = tempfile::tempdir().expect("tempdir");
        let socket = dir.path().join("helper.sock");
        let socket_for_wait = socket.clone();
        let mut listener = None;

        let observation = observe_listener_with(&socket, |_| {
            // The helper binds between attempts — a fresh registration
            // starting up, exactly the transient the window exists for.
            listener = Some(UnixListener::bind(&socket_for_wait).expect("bind"));
        });

        assert_eq!(observation, ListenerObservation::Listening);
    }
}
