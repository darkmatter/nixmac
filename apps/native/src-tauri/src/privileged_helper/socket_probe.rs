// Observation of the helper socket: is anything listening on it?
//
// This answers one question and attaches no policy to the answer. "Positively
// no listener" is a load-bearing observation — one of the few things that
// authorizes unregistering a registration, and one of the things that may let
// an activation take the administrator-password path — so what counts as proof
// of absence is pinned here and nowhere else: connection attempts that fail
// because the socket is missing or refuses, repeatedly over a bounded window.
// A timeout, an interruption, or any other failure is ambiguous and proves
// nothing. Anything that accepts a connection is a listener, whatever it turns
// out to be; deciding what answered is peer validation's job.
//
// No protocol bytes are ever written here, which is what makes the probe safe
// to point at a helper from any build, including the pre-contract one.
//
// Lives beside `client.rs` and depends only on the shared protocol constants.

use crate::privileged_helper::protocol::HELPER_SOCKET_PATH;
use std::os::unix::net::UnixStream;
use std::time::Duration;

/// Connection attempts that must all fail before an absence is positive. One
/// refusal proves nothing: launchd relaunches a crashed helper, and a socket
/// can be momentarily unbound while a fresh one binds.
pub const ABSENCE_ATTEMPTS: u32 = 3;

/// Spacing between those attempts.
pub const ABSENCE_ATTEMPT_INTERVAL: Duration = Duration::from_millis(2_500);

/// The window an absence verdict spans: the whole point of the constant is that
/// other bounded waits can be defined relative to it — in particular verifying
/// a *fresh* registration has to wait longer than this, because launchd still
/// has to spawn that helper and let it bind.
pub const POSITIVE_ABSENCE_WINDOW: Duration =
    ABSENCE_ATTEMPT_INTERVAL.saturating_mul(ABSENCE_ATTEMPTS - 1);

/// What one connection attempt showed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectionAttempt {
    /// No socket at the path (ENOENT).
    Missing,
    /// The socket exists and refused the connection (ECONNREFUSED): nothing is
    /// accepting on it.
    Refused,
    /// The connection was accepted, so something is listening.
    Answered,
    /// The attempt neither connected nor proved an absence.
    Ambiguous(String),
}

/// What repeated attempts proved about the socket.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ListenerObservation {
    /// Every attempt across the full window found the socket missing or
    /// refusing. This is the only value that may be read as "no helper process
    /// is running".
    PositivelyAbsent,
    /// Something accepted a connection.
    Listening,
    /// Neither proven — report it and mutate nothing.
    Ambiguous(String),
}

/// Waiting between attempts, injectable so tests cover the window without
/// spending it.
pub trait ProbeClock {
    fn wait(&self, interval: Duration);
}

/// The real clock.
pub struct SleepingClock;

impl ProbeClock for SleepingClock {
    fn wait(&self, interval: Duration) {
        std::thread::sleep(interval);
    }
}

/// Observes the helper socket over the full absence window.
///
/// Pure observation: nothing changes by calling it, whatever it finds.
pub fn observe_listener() -> ListenerObservation {
    observe_listener_at(std::path::Path::new(HELPER_SOCKET_PATH))
}

/// [`observe_listener`] against an explicit socket path, so tests drive the real
/// connect-and-classify path rather than a copy of it.
fn observe_listener_at(socket: &std::path::Path) -> ListenerObservation {
    observe_listener_with(&SleepingClock, &mut || attempt_connection(socket))
}

fn attempt_connection(socket: &std::path::Path) -> ConnectionAttempt {
    match UnixStream::connect(socket) {
        // Connecting is the whole exchange: the stream is dropped without a byte
        // written in either direction, which is what makes the probe safe to
        // point at a helper of any build.
        Ok(_stream) => ConnectionAttempt::Answered,
        Err(error) => classify_connect_error(&error),
    }
}

fn observe_listener_with(
    clock: &dyn ProbeClock,
    attempt: &mut dyn FnMut() -> ConnectionAttempt,
) -> ListenerObservation {
    for index in 0..ABSENCE_ATTEMPTS {
        if index > 0 {
            clock.wait(ABSENCE_ATTEMPT_INTERVAL);
        }
        match attempt() {
            // Keep going: absence is only established by the full window.
            ConnectionAttempt::Missing | ConnectionAttempt::Refused => {}
            ConnectionAttempt::Answered => return ListenerObservation::Listening,
            ConnectionAttempt::Ambiguous(detail) => return ListenerObservation::Ambiguous(detail),
        }
    }
    ListenerObservation::PositivelyAbsent
}

/// Maps a failed `connect` to what it proves. Only the two errors the contract
/// names count towards an absence; everything else, timeouts and interruptions
/// included, is ambiguous.
///
/// One caveat on the refusal, since it is the error that authorizes removing a
/// registration: on this platform a full accept backlog also reports
/// `ECONNREFUSED`, so a listener that has stopped accepting could in principle
/// read as absent. The contract defines absence in exactly these terms, and the
/// helper accepts on a dedicated loop — closing connections past its cap rather
/// than leaving them queued — so this is a wedged-process corner, not an
/// ordinary one.
fn classify_connect_error(error: &std::io::Error) -> ConnectionAttempt {
    match error.kind() {
        std::io::ErrorKind::NotFound => ConnectionAttempt::Missing,
        std::io::ErrorKind::ConnectionRefused => ConnectionAttempt::Refused,
        _ => ConnectionAttempt::Ambiguous(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// A clock that spends nothing and records what it was asked to wait.
    #[derive(Default)]
    struct RecordingClock {
        waited: Mutex<Vec<Duration>>,
    }

    impl RecordingClock {
        fn total(&self) -> Duration {
            self.waited.lock().expect("clock").iter().sum()
        }

        fn waits(&self) -> usize {
            self.waited.lock().expect("clock").len()
        }
    }

    impl ProbeClock for RecordingClock {
        fn wait(&self, interval: Duration) {
            self.waited.lock().expect("clock").push(interval);
        }
    }

    /// Drives the probe with a scripted sequence of attempts; running past the
    /// script is a failure, which is how "no more attempts than the window
    /// allows" is asserted.
    fn observe(
        clock: &RecordingClock,
        script: Vec<ConnectionAttempt>,
    ) -> (ListenerObservation, usize) {
        let mut attempts = script.into_iter();
        let mut made = 0;
        let observation = observe_listener_with(clock, &mut || {
            made += 1;
            attempts.next().expect("an attempt beyond the script")
        });
        (observation, made)
    }

    #[test]
    fn a_refusing_or_missing_socket_is_an_absence_only_after_the_full_window() {
        // Every mixture of the two absence-proving failures, and nothing else.
        for script in [
            vec![ConnectionAttempt::Refused; 3],
            vec![ConnectionAttempt::Missing; 3],
            vec![
                ConnectionAttempt::Missing,
                ConnectionAttempt::Refused,
                ConnectionAttempt::Missing,
            ],
        ] {
            let clock = RecordingClock::default();

            let (observation, attempts) = observe(&clock, script);

            assert_eq!(observation, ListenerObservation::PositivelyAbsent);
            assert_eq!(attempts, ABSENCE_ATTEMPTS as usize);
            // The verdict spans the window it claims to span.
            assert_eq!(clock.total(), POSITIVE_ABSENCE_WINDOW);
            assert_eq!(clock.waits(), ABSENCE_ATTEMPTS as usize - 1);
        }
    }

    #[test]
    fn an_ambiguous_attempt_ends_the_probe_and_never_proves_an_absence() {
        // A wedged helper that accepts but never answers, a signal, a
        // permissions problem: none of these may pass for "no process is
        // running", at any position in the window.
        for position in 0..ABSENCE_ATTEMPTS as usize {
            let mut script = vec![ConnectionAttempt::Refused; position];
            script.push(ConnectionAttempt::Ambiguous("timed out".to_string()));
            let clock = RecordingClock::default();

            let (observation, attempts) = observe(&clock, script);

            assert_eq!(
                observation,
                ListenerObservation::Ambiguous("timed out".to_string())
            );
            assert_eq!(attempts, position + 1);
        }
    }

    #[test]
    fn anything_that_answers_is_a_listener_even_late_in_the_window() {
        // launchd's KeepAlive can relaunch a helper mid-probe; the moment
        // something accepts, the absence is off.
        for position in 0..ABSENCE_ATTEMPTS as usize {
            let mut script = vec![ConnectionAttempt::Missing; position];
            script.push(ConnectionAttempt::Answered);
            let clock = RecordingClock::default();

            let (observation, attempts) = observe(&clock, script);

            assert_eq!(observation, ListenerObservation::Listening);
            assert_eq!(attempts, position + 1);
        }
    }

    #[test]
    fn only_a_missing_or_refusing_socket_counts_towards_an_absence() {
        assert_eq!(
            classify_connect_error(&std::io::Error::from(std::io::ErrorKind::NotFound)),
            ConnectionAttempt::Missing
        );
        assert_eq!(
            classify_connect_error(&std::io::Error::from(std::io::ErrorKind::ConnectionRefused)),
            ConnectionAttempt::Refused
        );
        for ambiguous in [
            std::io::ErrorKind::TimedOut,
            std::io::ErrorKind::Interrupted,
            std::io::ErrorKind::PermissionDenied,
            std::io::ErrorKind::WouldBlock,
            std::io::ErrorKind::ConnectionReset,
            std::io::ErrorKind::Other,
        ] {
            assert!(matches!(
                classify_connect_error(&std::io::Error::from(ambiguous)),
                ConnectionAttempt::Ambiguous(_)
            ));
        }
    }

    #[test]
    fn the_absence_window_is_the_span_of_its_own_attempts() {
        // Confirming an absence only has to outlast a socket that is already
        // gone, which is why this is deliberately short: anything that waits on
        // a *fresh* registration instead has to allow launchd to spawn the
        // helper and let it bind, and derives a longer window from this one.
        assert_eq!(
            POSITIVE_ABSENCE_WINDOW,
            ABSENCE_ATTEMPT_INTERVAL * (ABSENCE_ATTEMPTS - 1)
        );
        assert!(POSITIVE_ABSENCE_WINDOW <= Duration::from_secs(5));
    }

    #[test]
    fn the_real_probe_answers_from_a_listener_without_writing_a_byte() {
        // Zero protocol bytes is what makes the probe safe to point at a helper
        // of any build, including the pre-contract one that cannot parse this
        // build's requests. Driven through the production connect-and-classify
        // path, not a copy of it, so a stray write there would fail here.
        let directory = tempfile::tempdir().expect("temp dir");
        let socket = directory.path().join("probe.sock");
        let listener = std::os::unix::net::UnixListener::bind(&socket).expect("bind");
        let accepted = std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            let mut received = Vec::new();
            std::io::Read::read_to_end(&mut { &stream }, &mut received).expect("read");
            received
        });

        let observation = observe_listener_at(&socket);

        assert_eq!(observation, ListenerObservation::Listening);
        assert!(accepted.join().expect("accepted").is_empty());
    }

    #[test]
    fn a_path_nothing_ever_bound_is_a_missing_socket() {
        // The other half of the real attempt: what a socket that is not there
        // classifies as. Asserted on one attempt rather than through
        // `observe_listener_at`, which would spend the real window.
        let directory = tempfile::tempdir().expect("temp dir");

        assert_eq!(
            attempt_connection(&directory.path().join("never-bound.sock")),
            ConnectionAttempt::Missing
        );
    }
}
