use crate::privileged_helper::peer_auth;
use crate::privileged_helper::protocol::{
    ActivationRequest, BUILD_ID, HELPER_SOCKET_PATH, HelperReply, HelperRequest,
};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;

const CLIENT_TIMEOUT: Duration = Duration::from_secs(30);
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Status probes back the permissions UI; a wedged helper must not stall a
/// permissions refresh, so they get a short leash instead of CLIENT_TIMEOUT.
const STATUS_PROBE_TIMEOUT: Duration = Duration::from_secs(2);
/// `Retire` is answered promptly in every state, so its leash only needs to
/// absorb scheduling latency, never activation time.
#[allow(dead_code)]
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
/// the replacement flow's unregister step is built on. Dropping it closes
/// the connection, which is what every current caller wants.
#[derive(Debug)]
pub struct HelperExchange {
    pub reply: HelperReply,
    #[allow(dead_code)]
    pub connection: UnixStream,
}

pub fn socket_available() -> bool {
    std::path::Path::new(HELPER_SOCKET_PATH).exists()
}

fn exchange(
    request: &HelperRequest,
    read_timeout: Duration,
) -> Result<HelperExchange, HelperClientError> {
    let stream = UnixStream::connect(HELPER_SOCKET_PATH).map_err(HelperClientError::Unreachable)?;
    stream
        .set_read_timeout(Some(read_timeout))
        .map_err(HelperClientError::Io)?;
    stream
        .set_write_timeout(Some(CLIENT_TIMEOUT))
        .map_err(HelperClientError::Io)?;

    // Reciprocal check: whatever answers on the socket must be the signed
    // root helper before this process sends it anything.
    peer_auth::validate_helper_peer(&stream).map_err(HelperClientError::AuthenticationFailed)?;

    exchange_on(stream, request)
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

/// Sends `Status`. GUI-only by protocol policy: the sync agent has no
/// lifecycle role and the helper refuses every request from it but
/// `TryActivate`.
pub fn status() -> Result<HelperExchange, HelperClientError> {
    exchange(&HelperRequest::Status, STATUS_PROBE_TIMEOUT)
}

/// Sends `Retire`. GUI-only by protocol policy, like [`status`]. Dead code
/// until the GUI's helper-replacement reconciliation is wired up in a later
/// change; it lives here now because this file owns the wire vocabulary.
#[allow(dead_code)]
pub fn retire() -> Result<HelperExchange, HelperClientError> {
    exchange(&HelperRequest::Retire, RETIRE_TIMEOUT)
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
    use std::io::Read;

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
