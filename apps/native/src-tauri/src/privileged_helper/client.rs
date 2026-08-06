use crate::privileged_helper::peer_auth;
use crate::privileged_helper::protocol::{
    ActivationRequest, BUILD_ID, HELPER_SOCKET_PATH, HelperReply, HelperRequest,
};
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;

const CLIENT_TIMEOUT: Duration = Duration::from_secs(30);
/// The one generous bound in this client, and deliberately not one of the short
/// leashes above: an activation legitimately runs for many minutes, so nothing
/// shorter can be put here without turning ordinary long applies into lost
/// results. Half an hour is the accepted ceiling. An activation still running
/// when it expires is reported as an unknown outcome by an apply and as a
/// deferral by the sync agent — neither compensates for it, and the activation
/// itself keeps running. Do not reuse this on `Status` or `Retire`, and do not
/// shorten it to match them.
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Status probes back the permissions UI; a wedged helper must not stall a
/// permissions refresh, so they get a short leash instead of CLIENT_TIMEOUT.
const STATUS_PROBE_TIMEOUT: Duration = Duration::from_secs(2);
/// `Retire` is answered promptly in every state, so its leash only needs to
/// absorb scheduling latency, never activation time.
const RETIRE_TIMEOUT: Duration = Duration::from_secs(5);

/// Why one exchange with the helper produced no usable reply. Typed so every
/// caller decides from structure, never from display text. The
/// close-before-reply case is its own variant because it means something
/// specific: the helper (or whatever holds the socket) declined this client
/// before speaking — every caller treats it as "stop and re-observe". A
/// close *after* a reply is not an error at all; it is observed by whoever
/// holds [`HelperExchange::connection`] open.
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

/// One completed request/reply exchange. The connection is handed back open:
/// the helper never closes an authenticated connection, so a later peer-side
/// close on it always means the helper process ended — the liveness signal
/// the replacement flow's unregister step is built on ([`peer_still_open`]).
/// Dropping it closes the connection, which is what every caller but that one
/// wants.
#[derive(Debug)]
pub struct HelperExchange {
    pub reply: HelperReply,
    pub connection: UnixStream,
}

/// What answered the helper socket, judged before any protocol bytes crossed
/// it.
///
/// [`status`] collapses these into one `AuthenticationFailed`, which is all a
/// status readout needs.
/// Reconciliation needs them apart: a **root** peer whose validation completed
/// with a "no" is the pre-contract or tampered helper, which may be removed
/// without being asked to retire first, while a validation that could not
/// reach a judgment — or a peer that is not root — authorizes nothing at all.
#[derive(Debug)]
pub enum AssessedExchange {
    /// Root, and the pinned helper requirement is satisfied. The reply came
    /// from the signed helper, on a connection still open.
    Answered(HelperExchange),
    /// Root, and validation completed with a "no": unsigned, ad-hoc-signed, or
    /// the wrong identity. Not one byte was written to it, and none ever is.
    RootUnverifiable(String),
    /// Nothing may be concluded — a peer that is not root, or a validation that
    /// reached no judgment. No bytes were written.
    Unidentified(String),
}

/// Whether the socket path exists. Diagnostic only — it proves nothing about a
/// helper, which is why nothing in the app reads it: the sync agent's no-config
/// mode prints it, and every decision comes from an authenticated exchange or
/// from the absence window in `socket_probe`.
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
) -> Result<HelperExchange, HelperClientError> {
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
/// read exactly one reply, hand the still-open connection back.
fn exchange_on(
    stream: UnixStream,
    request: &HelperRequest,
) -> Result<HelperExchange, HelperClientError> {
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

    let reply = HelperReply::parse(&reply_line)
        .map_err(|error| HelperClientError::UnparseableReply(format!("{error:#}")))?;
    Ok(HelperExchange {
        reply,
        connection: stream,
    })
}

/// Sends `Status`, keeping the peer assessment. Reconciliation's discovery
/// exchange: it works against a helper of any build, and what it may do about
/// one it cannot talk to depends on which way the assessment went.
pub fn assessed_status() -> Result<AssessedExchange, HelperClientError> {
    assessed_exchange(&HelperRequest::Status, STATUS_PROBE_TIMEOUT)
}

/// Sends `Retire`, keeping the peer assessment. GUI-only by protocol policy,
/// like [`status`].
///
/// A `Retired` reply arrives on a connection still open, and that connection is
/// the caller's proof the helper has not died since — hold it and check
/// [`peer_still_open`] immediately before unregistering.
pub fn assessed_retire() -> Result<AssessedExchange, HelperClientError> {
    assessed_exchange(&HelperRequest::Retire, RETIRE_TIMEOUT)
}

/// Whether the peer of an already-answered connection is still there.
///
/// A live helper never closes an authenticated connection and never sends a
/// second reply, so an end-of-file here means that exact process ended — and
/// may already have been relaunched, `Idle`, by launchd. This is the liveness
/// check that stands between a `Retired` reply and unregistering the helper
/// that gave it.
///
/// Fails closed: only positive evidence of a peer — nothing to read yet, or
/// bytes that could only have come from a live one — answers yes. End of file,
/// a reset, an error the caller cannot interpret, even a failure to set the
/// mode this needs: all answer no, because the caller's next act is
/// terminating a helper.
pub fn peer_still_open(connection: &UnixStream) -> bool {
    if connection.set_nonblocking(true).is_err() {
        return false;
    }
    let mut unexpected = [0u8; 1];
    // `Read` is implemented for `&UnixStream`, so the read borrows the binding
    // rather than the connection.
    let mut peer = connection;
    let open = match peer.read(&mut unexpected) {
        // End of file: the peer is gone.
        Ok(0) => false,
        // Bytes nothing should have sent. Whatever they are, sending them
        // proves the peer was alive, which is the only question here.
        Ok(_) => true,
        Err(error) => error.kind() == std::io::ErrorKind::WouldBlock,
    };
    // Left as the caller handed it over, whichever way the answer went: a
    // stream stuck in non-blocking mode would turn this connection's later
    // reads into spurious failures. Only the blocking flag was touched — the
    // read timeout the connection was opened with is a separate option.
    let restored = connection.set_nonblocking(false).is_ok();
    open && restored
}

/// Dispatches `TryActivate`, stamped with this build's ID — the helper admits
/// it only if that ID is exactly its own. `ActivationRequest` is only
/// constructible through `protocol::activation_request`, so this entry point
/// cannot be handed a hand-assembled body with a non-canonicalized target. The
/// reply arrives on the same connection when the activation completes.
pub fn activate_store_path(
    request: &ActivationRequest,
) -> Result<HelperExchange, HelperClientError> {
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
    use crate::privileged_helper::protocol::HelperStateName;

    /// Runs `exchange_on` against a socketpair whose far end is driven by
    /// `respond`, which receives the request line the client wrote.
    fn exchange_against(
        respond: impl FnOnce(String, UnixStream) + Send + 'static,
    ) -> Result<HelperExchange, HelperClientError> {
        let (client, server) = UnixStream::pair().expect("socketpair");
        let far_end = std::thread::spawn(move || {
            let mut request = String::new();
            {
                let mut reader = BufReader::new(server.try_clone().expect("clone"));
                reader.read_line(&mut request).expect("read request");
            }
            respond(request, server);
        });
        let result = exchange_on(client, &HelperRequest::Status);
        far_end.join().expect("far end");
        result
    }

    #[test]
    fn a_reply_leaves_the_connection_open_for_the_caller_to_hold() {
        // The connection comes back open: a later peer-side close on it is
        // the liveness signal, so the exchange must not consume it.
        // The far end is handed back through this channel so it stays alive
        // past the assertions — otherwise the close under test would be the
        // test harness's own.
        let (far_end_keepalive, held) = std::sync::mpsc::channel();
        let exchange = exchange_against(move |request, mut server| {
            // `Status` is kind-only: it carries no build ID, because it is the
            // request that has to work against a helper of any build.
            assert_eq!(request, "{\"kind\":\"status\"}\n");
            let reply = HelperReply::Status {
                state: HelperStateName::Idle,
                helper_build_id: BUILD_ID.to_string(),
                activation: None,
            };
            server
                .write_all(format!("{}\n", reply.encode()).as_bytes())
                .expect("write reply");
            far_end_keepalive.send(server).expect("hand back far end");
        })
        .expect("exchange succeeds");
        let still_open = held.recv().expect("far end handed back");

        assert!(matches!(exchange.reply, HelperReply::Status { .. }));
        // Silence, not EOF: a zero-length read would mean the far end went
        // away, which is precisely what the caller watches for later.
        exchange
            .connection
            .set_read_timeout(Some(std::time::Duration::from_millis(100)))
            .expect("set timeout");
        let mut probe = [0u8; 1];
        match (&exchange.connection).read(&mut probe) {
            Ok(0) => panic!("the exchange consumed the connection"),
            Ok(_) => panic!("unexpected bytes after the one reply"),
            Err(error) => assert!(matches!(
                error.kind(),
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
            )),
        }

        // Once the far end really goes away, the same read reports EOF —
        // the liveness signal itself.
        drop(still_open);
        assert_eq!((&exchange.connection).read(&mut probe).expect("read"), 0);
    }

    #[test]
    fn a_close_before_any_reply_is_its_own_typed_outcome() {
        // Stop-and-re-observe: an authentication refusal and a helper at its
        // connection cap are deliberately indistinguishable here, and neither
        // is an ambiguous I/O failure.
        let error = exchange_against(|_request, server| drop(server))
            .expect_err("a close before any reply must not succeed");

        assert!(matches!(error, HelperClientError::ClosedBeforeReply));
    }

    #[test]
    fn only_a_root_peer_that_validates_may_be_written_to() {
        // The allowlist. Everything that is not "root, and validation said
        // yes" ends the exchange before a byte is written, and the two ways it
        // ends are kept apart: a completed "no" is the pre-contract or tampered
        // helper, which may be removed; a judgment that could not be reached
        // authorizes nothing at all. Getting these two backwards would either
        // make the legacy helper unremovable or make an unlucky validation
        // failure a licence to terminate a running one.
        assert!(matches!(
            peer_verdict(0, peer_auth::SignatureValidation::Valid),
            PeerVerdict::Authenticated
        ));
        assert!(matches!(
            peer_verdict(
                0,
                peer_auth::SignatureValidation::Invalid("unsigned".into())
            ),
            PeerVerdict::NotAuthenticated(AssessedExchange::RootUnverifiable(_))
        ));
        assert!(matches!(
            peer_verdict(0, peer_auth::SignatureValidation::Error("peer died".into())),
            PeerVerdict::NotAuthenticated(AssessedExchange::Unidentified(_))
        ));
        // Not root: unidentified whatever the signature says, the valid case
        // included.
        for validation in [
            peer_auth::SignatureValidation::Valid,
            peer_auth::SignatureValidation::Invalid("unsigned".into()),
            peer_auth::SignatureValidation::Error("peer died".into()),
        ] {
            assert!(matches!(
                peer_verdict(501, validation),
                PeerVerdict::NotAuthenticated(AssessedExchange::Unidentified(_))
            ));
        }
    }

    #[test]
    fn a_held_connection_reports_its_peer_gone_only_once_it_really_is() {
        // Rule 1's liveness check. A helper never closes an authenticated
        // connection, so this answers "is that exact process still there" —
        // and it is asked immediately before terminating it.
        let (held, far_end) = UnixStream::pair().expect("socketpair");

        assert!(peer_still_open(&held));

        drop(far_end);

        assert!(!peer_still_open(&held));
    }

    #[test]
    fn bytes_no_helper_should_have_sent_still_prove_it_was_alive() {
        // The helper ignores trailing bytes and never sends a second reply, so
        // this is anomalous — but a process that wrote something was running,
        // which is the only question being asked.
        let (held, mut far_end) = UnixStream::pair().expect("socketpair");
        far_end.write_all(b"?").expect("write");

        assert!(peer_still_open(&held));
    }

    #[test]
    fn the_liveness_check_hands_the_connection_back_blocking() {
        // It flips the connection to non-blocking to ask; leaving it that way
        // would turn every later read on it into a spurious failure.
        let (held, _far_end) = UnixStream::pair().expect("socketpair");
        let leash = std::time::Duration::from_millis(50);
        held.set_read_timeout(Some(leash)).expect("set timeout");

        assert!(peer_still_open(&held));

        // A blocking read waits out its leash; a non-blocking one would refuse
        // instantly.
        let started = std::time::Instant::now();
        let mut byte = [0u8; 1];
        assert!((&held).read(&mut byte).is_err());
        assert!(started.elapsed() >= leash / 2, "the read did not block");
    }

    #[test]
    fn a_reply_this_build_cannot_parse_is_a_typed_refusal_equivalent() {
        // What a helper from a build predating these reply shapes answers
        // with. It must never be mistaken for a state or a result.
        for wire in [
            r#"{"ok":true,"code":0,"stdout":"nixmac helper ready","error":null}"#,
            r#"{"reply":"somethingNew"}"#,
            "not json",
        ] {
            let error = exchange_against(move |_request, mut server| {
                server
                    .write_all(format!("{wire}\n").as_bytes())
                    .expect("write reply");
            })
            .expect_err("an unparseable reply must not succeed");

            assert!(matches!(error, HelperClientError::UnparseableReply(_)));
        }
    }
}
