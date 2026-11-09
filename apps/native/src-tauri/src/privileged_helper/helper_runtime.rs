use crate::privileged_helper::peer_auth::{self, ClientKind, ClientValidation, PeerIdentity};
use crate::privileged_helper::protocol::{
    ACTIVATION_LOCK_PATH, ACTIVATION_LOG_PATH, ActivationInfo, ActivationResult, BUILD_ID,
    HELPER_SOCKET_DIR, HELPER_SOCKET_PATH, HELPER_WARNING_PREFIX, HelperReply, HelperRequest,
    HelperStateName, TryActivateBody, validate_canonical_activate_path,
};
use anyhow::{Context, Result, anyhow, bail};
use std::ffi::CString;
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::os::fd::{AsFd, AsRawFd, BorrowedFd, FromRawFd, OwnedFd};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

/// Post-auth cap on the request line; real requests are well under 4 KiB.
const MAX_REQUEST_BYTES: u64 = 64 * 1024;

/// Hard cap on concurrently served connections. At capacity, the (cap+1)th
/// connection is accepted and closed before authentication and before any
/// protocol bytes — deliberately indistinguishable from the unauthenticated
/// close, which every client already treats as "stop and re-observe". No
/// frozen "at capacity" reply shape exists or may be added.
pub(crate) const MAX_CONCURRENT_CONNECTIONS: usize = 4;

/// Fixed PATH for the privileged activation: root-owned system and Nix
/// profile directories only. The protocol has no field for a requester to
/// offer a PATH, so nothing requester-supplied reaches root command lookup.
const ACTIVATION_PATH_ENV: &str =
    "/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const SYSTEM_PROFILE: &str = "/nix/var/nix/profiles/system";
const NIX_ENV_CANDIDATES: [&str; 2] = [
    "/nix/var/nix/profiles/default/bin/nix-env",
    "/run/current-system/sw/bin/nix-env",
];
const EXECUTE_BITS: u32 = 0o111;
const OTHER_WRITE_BIT: u32 = 0o002;
const GROUP_WRITE_BIT: u32 = 0o020;
const STICKY_BIT: u32 = 0o1000;
/// Sudoers rule older helpers created (and could leave behind on forced
/// termination). No longer written; removed on startup if present.
const LEGACY_SUDOERS_PATH: &str = "/etc/sudoers.d/nixmac-activate-helper";

/// Cap on how much of the activation log is read back into the result reply.
/// Bounds the helper's memory and the reply frame; the log file itself keeps
/// everything. (The requests cap above cannot serve here: activation output
/// is legitimately large.)
const REPLY_LOG_TAIL_BYTES: u64 = 512 * 1024;
const LOG_TRUNCATION_MARKER: &str =
    "nixmac-helper: earlier activation output truncated; the full log is in";

// ---------------------------------------------------------------------------
// The single activation slot.
//
// The slot is an exclusive `flock` on a root-owned lock file, held by the
// detached runner for exactly its lifetime — across helper generations, and
// shared with the password path's executor, so "an activation is running" has
// one source of truth however the activation was started. This process keeps
// only a display-level memory of the activation it spawned itself (X), and
// one mutex that serializes its own lock-file operations so a `Status` probe
// can never turn a racing admission into a spurious `Busy`. External holders
// are always real activations.
// ---------------------------------------------------------------------------

pub(crate) struct ActivationSlot {
    /// In-process serialization of every lock-file operation, plus X for the
    /// activation this process spawned (display only; cleared when it ends).
    current: Mutex<Option<ActivationInfo>>,
    lock_path: PathBuf,
}

impl ActivationSlot {
    pub(crate) fn new() -> Self {
        Self::at(PathBuf::from(ACTIVATION_LOCK_PATH))
    }

    /// Test seam: a slot over a lock file somewhere writable.
    pub(crate) fn at(lock_path: PathBuf) -> Self {
        Self {
            current: Mutex::new(None),
            lock_path,
        }
    }

    fn lock(&self) -> MutexGuard<'_, Option<ActivationInfo>> {
        self.current.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The `Status` answer, from live observation: this process's own memory
    /// when it spawned the running activation, else a momentary shared-lock
    /// probe (an exclusive holder elsewhere — an orphaned runner or the
    /// password path — is an activation running). Serialized with admission
    /// by the mutex, so the probe's `LOCK_SH` cannot make a concurrent
    /// admission in this process report a phantom `Busy`.
    fn status_reply(&self, helper_build_id: &str) -> HelperReply {
        let current = self.lock();
        let (state, activation) = match &*current {
            Some(info) => (HelperStateName::Activating, Some(info.clone())),
            None => match self.foreign_holder() {
                true => (HelperStateName::Activating, None),
                false => (HelperStateName::Idle, None),
            },
        };
        HelperReply::Status {
            state,
            helper_build_id: helper_build_id.to_string(),
            activation,
        }
    }

    /// Whether something outside this process holds the lock. Errors opening
    /// or probing the lock file are logged and read as "no holder": a helper
    /// that cannot observe its own lock cannot admit either, so nothing is
    /// decided from the optimistic answer.
    fn foreign_holder(&self) -> bool {
        match open_lock_file(&self.lock_path) {
            Ok(fd) => match try_flock(&fd, libc::LOCK_SH) {
                // The shared lock was granted, so no exclusive holder exists;
                // dropping the fd releases it immediately.
                Ok(true) => false,
                Ok(false) => true,
                Err(error) => {
                    eprintln!("nixmac-helper: failed to probe the activation lock: {error}");
                    false
                }
            },
            Err(error) => {
                eprintln!("nixmac-helper: failed to open the activation lock: {error}");
                false
            }
        }
    }

    /// `TryActivate` admission: takes the exclusive lock non-blocking, or
    /// answers `Busy` immediately. The lock attempt IS the admission decision
    /// — atomic across processes by `flock` itself, and serialized against
    /// this process's own status probes by the mutex. X's client kind is
    /// stamped from the helper's own validation of the submitting client,
    /// never from the request body.
    fn admit(
        &self,
        body: &TryActivateBody,
        client_kind: ClientKind,
    ) -> std::result::Result<AdmittedActivation<'_>, HelperReply> {
        let mut current = self.lock();
        if let Some(info) = &*current {
            return Err(HelperReply::Busy {
                activation: Some(info.clone()),
            });
        }
        let lock = open_lock_file(&self.lock_path).map_err(admission_failure)?;
        match try_flock(&lock, libc::LOCK_EX) {
            Ok(true) => {}
            // Held elsewhere: an orphaned runner from a previous helper
            // generation, or the password path. A real activation either way,
            // whose X this process never knew.
            Ok(false) => return Err(HelperReply::Busy { activation: None }),
            Err(error) => return Err(admission_failure(error)),
        }
        *current = Some(ActivationInfo {
            request_id: body.request_id.clone(),
            script_path: body.script_path.clone(),
            client_kind,
        });
        Ok(AdmittedActivation { slot: self, lock })
    }

    /// Only [`AdmittedActivation`]'s drop calls this.
    fn finish_activation(&self) {
        *self.lock() = None;
    }
}

/// An admission failure that is not `Busy`: the lock file itself could not be
/// used. Reported as a failed activation result — same-build reply, nothing
/// frozen — so the caller learns why instead of a bare refusal.
fn admission_failure(error: anyhow::Error) -> HelperReply {
    HelperReply::ActivationResult(ActivationResult {
        ok: false,
        code: -1,
        stdout: String::new(),
        error: Some(format!("could not take the activation lock: {error:#}")),
    })
}

/// Opens the lock file, creating it if missing. NEVER unlink or truncate it,
/// here or anywhere: `flock` binds to the inode, so recreating the file while
/// an orphaned runner holds the old inode's lock would silently double the
/// slot. (The socket's remove-before-bind pattern in `run_daemon` must not be
/// copied here.) `O_EXCL` is deliberately absent — the file legitimately
/// exists from the first activation of a boot on.
fn open_lock_file(path: &Path) -> Result<OwnedFd> {
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .with_context(|| format!("failed to open {}", path.display()))?;
    Ok(file.into())
}

/// One non-blocking `flock`. `Ok(true)` acquired, `Ok(false)` held elsewhere.
fn try_flock(fd: &OwnedFd, operation: libc::c_int) -> Result<bool> {
    // SAFETY: flock on an owned, open descriptor; no memory is involved.
    let outcome = unsafe { libc::flock(fd.as_raw_fd(), operation | libc::LOCK_NB) };
    if outcome == 0 {
        return Ok(true);
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::EWOULDBLOCK) {
        return Ok(false);
    }
    Err(anyhow!("flock failed: {error}"))
}

/// Proof that this request owns the single activation slot: the exclusive
/// lock, held here until the runner inherits it, plus this process's memory
/// of X. Constructed only by successful admission; drop clears the memory on
/// every exit path, unwind included. The lock itself outlives this value in
/// the runner's inherited descriptor — dropping the parent's copy releases
/// nothing while the runner lives.
pub(crate) struct AdmittedActivation<'slot> {
    slot: &'slot ActivationSlot,
    lock: OwnedFd,
}

impl std::fmt::Debug for AdmittedActivation<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AdmittedActivation")
    }
}

impl AdmittedActivation<'_> {
    /// The lock, for the runner spawn to inherit.
    pub(crate) fn lock_fd(&self) -> BorrowedFd<'_> {
        self.lock.as_fd()
    }

    /// Consumes the admission — clearing the memory and closing the parent's
    /// lock copy — and only then builds the reply reporting the activation's
    /// end, so a client holding a result may immediately re-dispatch. The
    /// explicit `drop` is load-bearing: left implicit, `self` would fall out
    /// of scope *after* the tail expression built the reply.
    fn into_result_reply(self, result: ActivationResult) -> HelperReply {
        drop(self);
        HelperReply::ActivationResult(result)
    }
}

impl Drop for AdmittedActivation<'_> {
    fn drop(&mut self) {
        self.slot.finish_activation();
    }
}

// ---------------------------------------------------------------------------
// Request handling.
// ---------------------------------------------------------------------------

enum RequestAction<'slot> {
    /// Reply immediately.
    Reply(HelperReply),
    /// Admitted: the slot is taken; the caller runs the activation, lets the
    /// admission drop, and only then sends the result reply.
    RunActivation {
        body: TryActivateBody,
        admitted: AdmittedActivation<'slot>,
    },
}

/// Which requests each authenticated caller may make. The GUI owns the
/// helper's lifecycle; the sync agent has none — it may only ask for an
/// activation, and gets the frozen `CallerNotPermitted` refusal for anything
/// else.
fn caller_may_send(client_kind: ClientKind, request: &HelperRequest) -> bool {
    match client_kind {
        ClientKind::Gui => true,
        ClientKind::SyncAgent => matches!(request, HelperRequest::TryActivate { .. }),
    }
}

/// Decides one authenticated request, in this order: the request either parses
/// completely or is not understood → the caller may or may not send it → a
/// `TryActivate` build ID either equals this helper's or is a build mismatch →
/// the slot-derived reply. `Status` carries no build ID and is answered
/// whatever the caller's build.
fn decide_request<'slot>(
    slot: &'slot ActivationSlot,
    client_kind: ClientKind,
    helper_build_id: &str,
    line: &str,
) -> RequestAction<'slot> {
    let Some(request) = HelperRequest::parse(line) else {
        return RequestAction::Reply(HelperReply::RequestNotUnderstood);
    };
    if !caller_may_send(client_kind, &request) {
        return RequestAction::Reply(HelperReply::CallerNotPermitted);
    }
    match request {
        HelperRequest::Status => RequestAction::Reply(slot.status_reply(helper_build_id)),
        HelperRequest::TryActivate { build_id, body } => {
            if build_id != helper_build_id {
                return RequestAction::Reply(HelperReply::BuildMismatch {
                    helper_build_id: helper_build_id.to_string(),
                });
            }
            match slot.admit(&body, client_kind) {
                Ok(admitted) => RequestAction::RunActivation { body, admitted },
                Err(refusal) => RequestAction::Reply(refusal),
            }
        }
    }
}

/// An authenticated connection's client: kernel-derived identity plus the
/// pinned requirement that matched.
pub(crate) struct AuthedClient {
    pub(crate) identity: PeerIdentity,
    pub(crate) kind: ClientKind,
}

type Authenticator = dyn Fn(&UnixStream) -> Option<AuthedClient> + Send + Sync;
type ActivationRunner = dyn for<'a> Fn(&AuthedClient, &TryActivateBody, &AdmittedActivation<'a>) -> ActivationResult
    + Send
    + Sync;

/// Everything one daemon instance serves connections with. The slot is the
/// only state; the closures are injection seams so the connection semantics
/// are testable without a signed peer or a real activation.
pub(crate) struct ServeConfig {
    pub(crate) slot: ActivationSlot,
    pub(crate) helper_build_id: String,
    pub(crate) authenticate: Box<Authenticator>,
    pub(crate) run_activation: Box<ActivationRunner>,
}

/// Serves one connection: authenticate (an unauthenticated peer receives no
/// protocol bytes — dropping the stream closes it), read exactly one
/// request, reply, close. The close carries no meaning a client may act on:
/// a close *before* the reply is the declined/over-cap signal, a close after
/// it is just the exchange being over.
fn serve_connection(mut stream: UnixStream, config: &ServeConfig) -> Result<()> {
    let Some(client) = (config.authenticate)(&stream) else {
        return Ok(());
    };

    let frame = read_request_line(stream.try_clone()?)?;
    let action = match frame {
        RequestFrame::PeerClosed => {
            // The peer closed without sending a request; nothing to answer.
            return Ok(());
        }
        RequestFrame::Complete(line) => match std::str::from_utf8(&line) {
            Ok(line) => decide_request(&config.slot, client.kind, &config.helper_build_id, line),
            // Invalid UTF-8 is an unreadable request, not a connection error.
            Err(_) => RequestAction::Reply(HelperReply::RequestNotUnderstood),
        },
        // A missing terminator or a line beyond the existing cap is an
        // unreadable request. Never dispatch from a valid-looking prefix.
        RequestFrame::Malformed => RequestAction::Reply(HelperReply::RequestNotUnderstood),
    };
    let reply = match action {
        RequestAction::Reply(reply) => reply,
        RequestAction::RunActivation { body, admitted } => {
            let result = (config.run_activation)(&client, &body, &admitted);
            // The admission is consumed — memory cleared, parent lock copy
            // closed — before one byte of the result reply is written.
            admitted.into_result_reply(result)
        }
    };
    stream.write_all(reply.encode().as_bytes())?;
    stream.write_all(b"\n")?;
    stream.flush()?;
    // Dropping the stream closes the connection: one request, one reply,
    // done. Nothing holds helper connections open — there is no liveness
    // signal to preserve — and a freed descriptor is a freed connection slot.
    Ok(())
}

enum RequestFrame {
    PeerClosed,
    Complete(Vec<u8>),
    Malformed,
}

/// Reads one newline-terminated request as raw bytes. UTF-8 decoding belongs
/// to request classification, and a missing terminator or a line beyond the
/// existing cap is malformed rather than an admissible JSON prefix.
fn read_request_line(stream: impl Read) -> std::io::Result<RequestFrame> {
    let mut line = Vec::new();
    BufReader::new(stream)
        .take(MAX_REQUEST_BYTES + 1)
        .read_until(b'\n', &mut line)?;
    if line.is_empty() {
        Ok(RequestFrame::PeerClosed)
    } else if line.len() as u64 <= MAX_REQUEST_BYTES && line.last() == Some(&b'\n') {
        Ok(RequestFrame::Complete(line))
    } else {
        Ok(RequestFrame::Malformed)
    }
}

/// Holds one of the bounded connection slots and releases it on drop —
/// including while unwinding. A slot leaked by a panicking connection thread
/// would never come back for the rest of the process lifetime, and four of
/// them would wedge the helper into refusing every connection.
struct ConnectionSlot(Arc<AtomicUsize>);

impl ConnectionSlot {
    /// Takes a slot, or `None` at capacity.
    fn acquire(active: &Arc<AtomicUsize>) -> Option<Self> {
        active
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < MAX_CONCURRENT_CONNECTIONS).then_some(count + 1)
            })
            .ok()
            .map(|_| Self(Arc::clone(active)))
    }
}

impl Drop for ConnectionSlot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

/// Accept loop with bounded concurrent connection handling.
pub(crate) fn serve(listener: UnixListener, config: Arc<ServeConfig>) -> Result<()> {
    let active = Arc::new(AtomicUsize::new(0));
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let Some(slot) = ConnectionSlot::acquire(&active) else {
                    // At capacity: accepted and closed before authentication
                    // and before any protocol bytes.
                    drop(stream);
                    continue;
                };
                let config = Arc::clone(&config);
                let spawned = std::thread::Builder::new().spawn(move || {
                    // Dropped when this thread ends by any route, panic
                    // included, so the slot always returns.
                    let _slot = slot;
                    if let Err(error) = serve_connection(stream, &config) {
                        eprintln!("nixmac-helper: request failed: {error:#}");
                    }
                });
                if spawned.is_err() {
                    eprintln!("nixmac-helper: failed to spawn connection thread");
                }
            }
            Err(error) => eprintln!("nixmac-helper: connection failed: {error}"),
        }
    }

    Ok(())
}

pub fn run_daemon() -> Result<()> {
    if let Err(error) = fs::remove_file(LEGACY_SUDOERS_PATH)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        // Keep serving — failing startup would not remove the rule either —
        // but a stale NOPASSWD grant must never go unnoticed.
        eprintln!(
            "nixmac-helper: SECURITY: failed to remove legacy sudoers rule {LEGACY_SUDOERS_PATH}: {error}"
        );
    }
    fs::create_dir_all(HELPER_SOCKET_DIR)?;
    let socket_path = Path::new(HELPER_SOCKET_PATH);
    // The SOCKET is removed before rebinding — a socket file cannot be bound
    // over. This pattern must never spread to the activation lock file, whose
    // inode identity is what the single slot rests on (see `open_lock_file`).
    if socket_path.exists() {
        fs::remove_file(socket_path)?;
    }

    let listener = UnixListener::bind(socket_path)?;
    harden_socket_permissions(socket_path)?;

    serve(
        listener,
        Arc::new(ServeConfig {
            slot: ActivationSlot::new(),
            helper_build_id: BUILD_ID.to_string(),
            authenticate: Box::new(authenticate_peer),
            run_activation: Box::new(|client, body, admitted| {
                run_detached_activation(&client.identity, body, admitted)
            }),
        }),
    )
}

fn harden_socket_permissions(socket_path: &Path) -> Result<()> {
    let admin_gid = admin_group_id();
    // A failed chown is not fatal (the daemon can still serve whoever the
    // default ownership admits) but must not pass silently: with the 0600
    // mode below it would leave a socket the GUI cannot connect to and no
    // trace of why.
    if let Some(console_uid) = peer_auth::console_user_uid() {
        if let Err(error) = std::os::unix::fs::chown(socket_path, Some(console_uid), admin_gid) {
            eprintln!("nixmac-helper: failed to chown the socket to the console user: {error}");
        }
        fs::set_permissions(socket_path, fs::Permissions::from_mode(0o600))?;
    } else {
        if let Err(error) = std::os::unix::fs::chown(socket_path, Some(0), admin_gid) {
            eprintln!("nixmac-helper: failed to chown the socket to root: {error}");
        }
        fs::set_permissions(socket_path, fs::Permissions::from_mode(0o660))?;
    }
    Ok(())
}

/// Gid of the macOS `admin` group, the socket's group owner.
fn admin_group_id() -> Option<u32> {
    nix::unistd::Group::from_name("admin")
        .ok()
        .flatten()
        .map(|group| group.gid.as_raw())
}

/// Pre-authentication admission: the socket-credential policy first, then
/// per-binary signature classification. A peer failing either is closed
/// before any protocol bytes — never a typed refusal.
fn authenticate_peer(stream: &UnixStream) -> Option<AuthedClient> {
    let identity = match peer_auth::peer_identity(stream) {
        Ok(identity) => identity,
        Err(error) => {
            eprintln!("nixmac-helper: failed to read peer identity: {error:#}");
            return None;
        }
    };
    if let Err(error) = check_peer_policy(identity.euid, peer_auth::console_user_uid()) {
        eprintln!("nixmac-helper: rejected peer: {error:#}");
        return None;
    }
    match peer_auth::classify_client(&identity) {
        ClientValidation::Valid(kind) => Some(AuthedClient { identity, kind }),
        ClientValidation::Invalid(detail) | ClientValidation::Error(detail) => {
            eprintln!("nixmac-helper: rejected peer: {detail}");
            None
        }
    }
}

/// The peer must be the active console user; root is rejected outright (the
/// GUI and sync agent always run in the user session).
///
/// Note the breadth deliberately: this gate covers `Status` too, not just
/// activation, and it runs *before* signature validation — a peer failing it
/// is closed without protocol bytes rather than answered with a typed
/// refusal. Narrower is the conservative direction, and it is what the
/// socket's own permissions already imply (the socket is mode 0600 owned by
/// the console user, so a second login session cannot reach it at all).
/// Consequence worth knowing before widening or narrowing this: a
/// second-session GUI reports and defers instead of converging. Changing the
/// socket's ownership or mode is a separate piece of work; do not scope this
/// gate down without it.
fn check_peer_policy(peer_euid: u32, console_uid: Option<u32>) -> Result<()> {
    if peer_euid == 0 {
        bail!("root peers may not drive activation");
    }
    let Some(console_uid) = console_uid else {
        bail!("no active console user");
    };
    if peer_euid != console_uid {
        bail!("peer uid {peer_euid} does not match console user uid {console_uid}");
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Activation execution: the detached runner.
//
// The helper never runs an activation in-process. It validates, prepares
// everything in ordinary safe Rust, then forks the runner — its own session,
// surviving `SMAppService` unregister together with the plist's
// AbandonProcessGroup — whose post-fork code lives in the `activation-runner`
// no_std crate (see its crate docs for why syscalls-only is enforced there).
// The runner holds the activation lock, execs the activate script with
// stdio on the log file, runs the profile update, and exits — releasing the
// lock. The parent waits for it and reads a capped log tail back into the
// result reply.
// ---------------------------------------------------------------------------

/// Runs one admitted activation to completion in a detached runner and folds
/// every failure into the result reply, so an activation that could not run
/// still reports an outcome rather than unwinding.
fn run_detached_activation(
    peer: &PeerIdentity,
    body: &TryActivateBody,
    admitted: &AdmittedActivation<'_>,
) -> ActivationResult {
    match detached_activation(peer, &body.script_path, admitted.lock_fd()) {
        Ok(result) => result,
        Err(error) => ActivationResult {
            ok: false,
            code: -1,
            stdout: String::new(),
            error: Some(format!("{error:#}")),
        },
    }
}

fn detached_activation(
    peer: &PeerIdentity,
    script_path: &str,
    lock: BorrowedFd<'_>,
) -> Result<ActivationResult> {
    let activate_path = canonical_activation_target(script_path)?;
    let argv = activation_argv_for_peer(peer, &activate_path)?;
    let (code, stdout) = spawn_runner(
        &argv,
        profile_update_argv(&activate_path)?.as_deref(),
        Path::new(ACTIVATION_LOG_PATH),
        lock,
    )?;
    Ok(ActivationResult {
        ok: code == 0,
        code,
        stdout,
        error: None,
    })
}

/// The post-activation profile update as a ready argv, or `None` when no
/// root-owned `nix-env` exists (the runner then writes the warning). Runs
/// inside the runner, after a successful activate — one unit, so a helper
/// replacement can no longer land between the two. The password path's
/// in-process twin is [`set_system_profile`]; keep the two commands
/// identical when touching either.
fn profile_update_argv(activate_path: &str) -> Result<Option<Vec<String>>> {
    let system_path = Path::new(activate_path)
        .parent()
        .context("activation path has no parent")?;
    let Some(nix_env) = NIX_ENV_CANDIDATES
        .iter()
        .find(|candidate| Path::new(candidate).exists())
    else {
        return Ok(None);
    };
    Ok(Some(vec![
        (*nix_env).to_string(),
        "-p".to_string(),
        SYSTEM_PROFILE.to_string(),
        "--set".to_string(),
        system_path.to_string_lossy().into_owned(),
    ]))
}

/// A null-terminated C argv/envp built pre-fork, so the post-fork child only
/// reads pointers. The pointer table borrows the owned strings; both live in
/// this value, which the parent keeps alive across the fork.
struct CArgv {
    _strings: Vec<CString>,
    pointers: Vec<*const libc::c_char>,
}

impl CArgv {
    fn new(values: &[String]) -> Result<Self> {
        let strings = values
            .iter()
            .map(|value| CString::new(value.as_str()).context("argument contains a NUL byte"))
            .collect::<Result<Vec<_>>>()?;
        let mut pointers: Vec<*const libc::c_char> =
            strings.iter().map(|value| value.as_ptr()).collect();
        pointers.push(std::ptr::null());
        Ok(Self {
            _strings: strings,
            pointers,
        })
    }

    fn as_ptr(&self) -> *const *const libc::c_char {
        self.pointers.as_ptr()
    }
}

/// Duplicates `fd` above the stdio range if needed, so the runner's dup2
/// chain cannot close a source before copying it.
fn above_stdio(fd: OwnedFd) -> Result<OwnedFd> {
    if fd.as_raw_fd() > 3 {
        return Ok(fd);
    }
    // SAFETY: F_DUPFD on an owned, open descriptor.
    let raised = unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_DUPFD, 10) };
    if raised < 0 {
        bail!(
            "failed to raise descriptor: {}",
            std::io::Error::last_os_error()
        );
    }
    // SAFETY: freshly returned by F_DUPFD, owned by nothing else.
    Ok(unsafe { OwnedFd::from_raw_fd(raised) })
}

/// Forks the detached runner, waits it out, and reads the capped log tail
/// back. The child executes only `activation_runner::run` — no
/// allocation, no unwinding — and `_exit`s with the activation's code.
fn spawn_runner(
    activate_argv: &[String],
    profile_argv: Option<&[String]>,
    log_path: &Path,
    lock: BorrowedFd<'_>,
) -> Result<(i32, String)> {
    // Everything the child touches, built before the fork.
    let activate = CArgv::new(activate_argv)?;
    let empty_env = CArgv::new(&[])?;
    let profile = profile_argv.map(CArgv::new).transpose()?;
    let profile_env = CArgv::new(&[format!("PATH={ACTIVATION_PATH_ENV}")])?;
    let warning = format!("{HELPER_WARNING_PREFIX} failed to update system profile\n");

    let devnull: OwnedFd = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open("/dev/null")
        .context("failed to open /dev/null")?
        .into();
    let log: OwnedFd = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(log_path)
        .with_context(|| format!("failed to open activation log {}", log_path.display()))?
        .into();
    let devnull = above_stdio(devnull)?;
    let log = above_stdio(log)?;
    // The lock is borrowed from the admission; a duplicate keeps ownership
    // simple and is closed with the other parent copies after the fork.
    // SAFETY: F_DUPFD on an owned, open descriptor.
    let lock_dup = unsafe { libc::fcntl(lock.as_raw_fd(), libc::F_DUPFD, 10) };
    if lock_dup < 0 {
        bail!(
            "failed to duplicate the activation lock: {}",
            std::io::Error::last_os_error()
        );
    }
    // SAFETY: freshly returned by F_DUPFD, owned by nothing else.
    let lock_dup = unsafe { OwnedFd::from_raw_fd(lock_dup) };

    let plan = activation_runner::RunnerPlan {
        activate_argv: activate.as_ptr(),
        activate_envp: empty_env.as_ptr(),
        profile_argv: profile
            .as_ref()
            .map_or(std::ptr::null(), |profile| profile.as_ptr()),
        profile_envp: profile_env.as_ptr(),
        profile_warning: warning.as_ptr(),
        profile_warning_len: warning.len(),
        devnull_fd: devnull.as_raw_fd(),
        log_fd: log.as_raw_fd(),
        lock_fd: lock_dup.as_raw_fd(),
        // SAFETY: getdtablesize has no preconditions.
        fd_limit: unsafe { libc::getdtablesize() },
    };

    // SAFETY: fork in a multithreaded process; the child calls only
    // `activation_runner::run` (async-signal-safe by that crate's contract)
    // and `_exit`.
    let pid = unsafe { libc::fork() };
    if pid < 0 {
        bail!(
            "failed to fork the activation runner: {}",
            std::io::Error::last_os_error()
        );
    }
    if pid == 0 {
        // CHILD. Nothing but the runner's code may run here.
        // SAFETY: freshly forked child; the plan's pointers and fds are the
        // copied parent allocations, valid until _exit.
        let code = unsafe { activation_runner::run(&plan) };
        // SAFETY: terminating the child without running any parent-owned
        // destructors, which is the point.
        unsafe { libc::_exit(code) };
    }

    // Parent: the runner owns its copies now; close this function's. One
    // parent fd on the lock's open file description deliberately remains —
    // the admission fd inside `AdmittedActivation` — so the lock is held
    // until the runner exits AND the admission drops at reply-build time
    // (`into_result_reply`). A helper killed mid-wait loses that fd with the
    // process, leaving the runner's own descriptor as the lock's exact
    // lifetime.
    drop(devnull);
    drop(lock_dup);

    let mut status: libc::c_int = 0;
    loop {
        // SAFETY: waitpid on our own direct child.
        let waited = unsafe { libc::waitpid(pid, &mut status, 0) };
        if waited == pid {
            break;
        }
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::EINTR) {
            bail!("failed to wait for the activation runner: {error}");
        }
    }
    let code = if libc::WIFEXITED(status) {
        libc::WEXITSTATUS(status)
    } else if libc::WIFSIGNALED(status) {
        128 + libc::WTERMSIG(status)
    } else {
        -1
    };

    drop(log);
    Ok((code, read_log_tail(log_path)?))
}

/// The last [`REPLY_LOG_TAIL_BYTES`] of the activation log, with a marker
/// line when older output was left behind in the file.
fn read_log_tail(log_path: &Path) -> Result<String> {
    let mut file = fs::File::open(log_path)
        .with_context(|| format!("failed to read activation log {}", log_path.display()))?;
    let len = file
        .metadata()
        .context("failed to stat activation log")?
        .len();
    let mut tail = String::new();
    if len > REPLY_LOG_TAIL_BYTES {
        file.seek(SeekFrom::End(-(REPLY_LOG_TAIL_BYTES as i64)))
            .context("failed to seek activation log")?;
        tail.push_str(&format!("{LOG_TRUNCATION_MARKER} {}\n", log_path.display()));
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .context("failed to read activation log")?;
    tail.push_str(&String::from_utf8_lossy(&bytes));
    Ok(tail)
}

/// Resolves and authorizes the activation target at the privileged boundary,
/// immediately before execution. The client's own canonicalization is a
/// convenience, never a security input: a lexically valid request path can
/// still contain symlinked or requester-writable components. The path is
/// canonicalized here, revalidated, and every component is proved immutable
/// to the (non-root) requester before root executes it. Shared by the helper
/// daemon and the interactive fallback's root re-entry
/// (`privileged_helper::root_activation`).
pub(crate) fn canonical_activation_target(activate_path: &str) -> Result<String> {
    // Lexical shape first, so a relative or non-store request never reaches
    // the filesystem (`canonicalize` would resolve it against the daemon's
    // cwd).
    validate_canonical_activate_path(activate_path)?;
    let canonical = fs::canonicalize(activate_path)
        .with_context(|| format!("failed to resolve activation path {activate_path}"))?;
    let canonical = validate_canonical_activate_path(canonical)?;
    check_activation_path_unwritable(&canonical)?;
    canonical
        .into_os_string()
        .into_string()
        .map_err(|path| anyhow!("canonical activation path is not valid UTF-8: {path:?}"))
}

/// Walks every component of the canonical activation path — `/`, `/nix`,
/// `/nix/store`, the store item, and the activate executable — and rejects
/// any the requester could retarget. Root ownership plus no group/other
/// write access is what makes check-then-exec sound here: once the walk
/// passes, a non-root requester cannot swap any component between this walk
/// and the exec.
fn check_activation_path_unwritable(canonical: &Path) -> Result<()> {
    let mut chain: Vec<&Path> = canonical.ancestors().collect();
    chain.reverse();
    for path in &chain {
        let metadata = fs::symlink_metadata(path)
            .with_context(|| format!("failed to inspect {}", path.display()))?;
        check_component_metadata(path, &metadata, *path == canonical)?;
    }
    Ok(())
}

fn check_component_metadata(
    path: &Path,
    metadata: &fs::Metadata,
    is_activation_target: bool,
) -> Result<()> {
    // The path was resolved a moment ago, so a symlink here means the tree
    // changed underneath us.
    if metadata.file_type().is_symlink() {
        bail!("{} is a symlink", path.display());
    }
    if is_activation_target {
        if !metadata.is_file() {
            bail!("activation target {} is not a regular file", path.display());
        }
        if metadata.mode() & EXECUTE_BITS == 0 {
            bail!("activation target {} is not executable", path.display());
        }
    } else if !metadata.is_dir() {
        bail!("{} is not a directory", path.display());
    }
    check_component_policy(path, metadata.uid(), metadata.mode(), metadata.is_dir())
}

/// Ownership/mode policy for one path component: root-owned, never
/// world-writable, and never group-writable — except the store root itself,
/// which is 1775 root:nixbld in the standard multi-user layout. The sticky
/// bit stops group members from replacing or removing the resolved store
/// item, and creating unrelated siblings gains them nothing. That is not
/// true anywhere else on the path: entries created *inside* a store item
/// sit next to the activation executable, so the exception must never
/// extend past `/nix/store`.
fn check_component_policy(path: &Path, owner_uid: u32, mode: u32, is_dir: bool) -> Result<()> {
    if owner_uid != 0 {
        bail!("{} is owned by uid {owner_uid}, not root", path.display());
    }
    if mode & OTHER_WRITE_BIT != 0 {
        bail!("{} is world-writable", path.display());
    }
    let sticky_store_root = is_dir && mode & STICKY_BIT != 0 && path == Path::new("/nix/store");
    if mode & GROUP_WRITE_BIT != 0 && !sticky_store_root {
        bail!("{} is group-writable", path.display());
    }
    Ok(())
}

/// Runs a prepared activation argv IN-PROCESS with stderr merged into stdout,
/// for the admin-password path's root re-entry only
/// (`privileged_helper::root_activation`): that executor is its own fresh
/// root process, already independent of any daemon's fate, so it needs no
/// detached runner — but it takes the same activation lock. The helper
/// daemon never calls this; its activations run in the detached runner.
pub(crate) fn run_activation_command(
    argv: &[String],
) -> Result<(std::process::ExitStatus, String)> {
    let (mut reader, writer) = std::io::pipe().context("failed to create activation pipe")?;
    let mut command = Command::new(&argv[0]);
    command
        .args(&argv[1..])
        .stdout(
            writer
                .try_clone()
                .context("failed to clone activation pipe")?,
        )
        .stderr(writer);
    let mut child = command.spawn().context("failed to execute activation")?;
    // The command still holds write ends of the pipe; drop them so the read
    // below ends when the child (and its descendants) exit.
    drop(command);
    let mut output = Vec::new();
    std::io::Read::read_to_end(&mut reader, &mut output)
        .context("failed to read activation output")?;
    let status = child.wait().context("failed to wait for activation")?;
    Ok((status, String::from_utf8_lossy(&output).to_string()))
}

/// What [`acquire_activation_lock`] bails with when the slot is held. On the
/// admin-password path this reaches the app only as process text (osascript
/// wraps the exit), so `rebuild::darwin::classify_activate_error` matches this
/// sentence to report a refusal instead of a generic failure.
pub(crate) const ACTIVATION_ALREADY_RUNNING_MESSAGE: &str =
    "an activation is already running; try again once it finishes";

/// Takes the shared activation slot for the admin-password path's executor.
/// `Ok(fd)` holds the exclusive lock until the fd drops — the caller keeps it
/// alive across the whole activation. `Ok(None)`-shaped refusal is an error
/// here: an activation is already running, and the caller reports rather
/// than waits.
pub(crate) fn acquire_activation_lock() -> Result<OwnedFd> {
    fs::create_dir_all(HELPER_SOCKET_DIR).context("failed to create the helper directory")?;
    let lock = open_lock_file(Path::new(ACTIVATION_LOCK_PATH))?;
    if !try_flock(&lock, libc::LOCK_EX)? {
        bail!("{ACTIVATION_ALREADY_RUNNING_MESSAGE}");
    }
    Ok(lock)
}

/// Direct-exec activation command: no shell, absolute programs only, a fixed
/// root-owned PATH, and an otherwise empty environment (`env -i`).
/// SSH_AUTH_SOCK is deliberately absent: builds and fetches already ran as
/// the user, so privileged activation receives no capability to reach a
/// user's SSH agent.
pub(crate) fn activation_argv(uid: u32, account: &UserAccount, activate_path: &str) -> Vec<String> {
    vec![
        "/bin/launchctl".to_string(),
        "asuser".to_string(),
        uid.to_string(),
        "/usr/bin/env".to_string(),
        "-i".to_string(),
        format!("PATH={ACTIVATION_PATH_ENV}"),
        format!("HOME={}", account.home),
        format!("USER={}", account.name),
        format!("LOGNAME={}", account.name),
        activate_path.to_string(),
    ]
}

/// The privileged command for one authenticated peer. Every
/// requester-derived input comes from the peer's socket credentials: the
/// account is looked up by the authenticated uid — the protocol has no field
/// to override it — and that uid, name, and home populate the activation
/// argv and environment.
fn activation_argv_for_peer(peer: &PeerIdentity, activate_path: &str) -> Result<Vec<String>> {
    let account = user_account(peer.euid)?;
    Ok(activation_argv(peer.euid, &account, activate_path))
}

pub(crate) fn post_activation_maintenance(activate_path: &str) -> Option<String> {
    set_system_profile(activate_path)
        .err()
        .map(|error| format!("failed to update system profile: {error:#}"))
}

/// In-process profile update, for the password path's executor. The helper
/// daemon's runner performs the same step via `profile_update_argv` inside
/// the runner.
fn set_system_profile(activate_path: &str) -> Result<()> {
    let system_path = Path::new(activate_path)
        .parent()
        .context("activation path has no parent")?;
    let nix_env = NIX_ENV_CANDIDATES
        .iter()
        .find(|candidate| Path::new(candidate).exists())
        .context("nix-env not found in root-owned profile directories")?;
    let output = Command::new(nix_env)
        .args(["-p", SYSTEM_PROFILE, "--set"])
        .arg(system_path)
        .env_clear()
        .env("PATH", ACTIVATION_PATH_ENV)
        .output()
        .context("failed to execute nix-env")?;
    if !output.status.success() {
        bail!(
            "nix-env --set failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

pub(crate) struct UserAccount {
    name: String,
    home: String,
}

/// Resolves the account name and home directory for `uid` from the user
/// database, so privileged activation never trusts requester-supplied
/// account values.
#[cfg(target_os = "macos")]
pub(crate) fn user_account(uid: u32) -> Result<UserAccount> {
    let user = nix::unistd::User::from_uid(nix::unistd::Uid::from_raw(uid))
        .context("failed to look up peer account")?
        .with_context(|| format!("no account found for peer uid {uid}"))?;
    let name = user.name;
    let home = user.dir.to_string_lossy().into_owned();
    if name.is_empty() || home.is_empty() {
        bail!("peer uid {uid} resolves to an account without a name or home");
    }
    Ok(UserAccount { name, home })
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn user_account(_uid: u32) -> Result<UserAccount> {
    bail!("peer account lookup is only implemented on macOS")
}

#[cfg(test)]
mod tests {
    use super::*;

    const HELPER_BUILD: &str = "build-a";
    const OTHER_BUILD: &str = "build-b";
    const SCRIPT: &str = "/nix/store/abc-darwin-system/activate";

    fn body(request_id: &str) -> TryActivateBody {
        TryActivateBody {
            request_id: request_id.to_string(),
            script_path: SCRIPT.to_string(),
        }
    }

    fn status_line() -> String {
        HelperRequest::Status.encode()
    }

    fn try_activate_line(build_id: &str, request_id: &str) -> String {
        HelperRequest::TryActivate {
            build_id: build_id.to_string(),
            body: body(request_id),
        }
        .encode()
    }

    /// A slot over a tempdir lock file, plus the dir keeping it alive.
    fn test_slot() -> (ActivationSlot, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        (ActivationSlot::at(dir.path().join("activation.lock")), dir)
    }

    /// Serializes the tests that fork against the tests that assert flock
    /// release. A freshly forked runner briefly holds copies of every fd
    /// in this test process — other tests' lock fds included, and a `flock`
    /// lives until every fd of its open file description closes — so a
    /// concurrent "dropping the admission released the lock" assertion can
    /// observe a lock the child is still microseconds from closing. A test
    /// artifact only: the real helper has one admitted lock at a time by
    /// construction, and a lingering probe copy can at worst answer one
    /// transient `Busy`.
    fn exclusive_fds() -> MutexGuard<'static, ()> {
        static FDS: Mutex<()> = Mutex::new(());
        FDS.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn state_of(slot: &ActivationSlot) -> (HelperStateName, Option<ActivationInfo>) {
        match slot.status_reply(HELPER_BUILD) {
            HelperReply::Status {
                state, activation, ..
            } => (state, activation),
            other => panic!("status_reply answered {other:?}"),
        }
    }

    // ------------------------------------------------------------------
    // The slot: flock-backed admission and observation.
    // ------------------------------------------------------------------

    #[test]
    fn an_idle_slot_admits_and_reports_the_activation_it_admitted() {
        let _fds = exclusive_fds();
        let (slot, _dir) = test_slot();
        assert_eq!(state_of(&slot).0, HelperStateName::Idle);

        let admitted = slot
            .admit(&body("req-1"), ClientKind::Gui)
            .expect("admitted");

        let (state, activation) = state_of(&slot);
        assert_eq!(state, HelperStateName::Activating);
        let info = activation.expect("this process knows X");
        assert_eq!(info.request_id, "req-1");
        assert_eq!(info.client_kind, ClientKind::Gui);

        // A second admission is refused with X, from memory.
        match slot.admit(&body("req-2"), ClientKind::SyncAgent) {
            Err(HelperReply::Busy {
                activation: Some(info),
            }) => assert_eq!(info.request_id, "req-1"),
            other => panic!("unexpected admission outcome: {other:?}"),
        }

        // The end transition precedes the reply the caller then sends.
        let reply = admitted.into_result_reply(ActivationResult {
            ok: true,
            code: 0,
            stdout: String::new(),
            error: None,
        });
        assert!(matches!(reply, HelperReply::ActivationResult(_)));
        assert_eq!(state_of(&slot).0, HelperStateName::Idle);
        assert!(slot.admit(&body("req-3"), ClientKind::Gui).is_ok());
    }

    #[test]
    fn a_foreign_lock_holder_is_an_activation_without_details() {
        let _fds = exclusive_fds();
        // Another process — an orphaned runner or the password executor —
        // holds the exclusive lock: modeled by a second slot over the same
        // file, which is a distinct open file description exactly like a
        // foreign process's.
        let (slot, dir) = test_slot();
        let foreign = ActivationSlot::at(dir.path().join("activation.lock"));
        let held = foreign
            .admit(&body("foreign"), ClientKind::Gui)
            .expect("foreign admission");

        let (state, activation) = state_of(&slot);
        assert_eq!(state, HelperStateName::Activating);
        assert!(activation.is_none(), "X was never known to this process");

        match slot.admit(&body("req-1"), ClientKind::Gui) {
            Err(HelperReply::Busy { activation: None }) => {}
            other => panic!("unexpected admission outcome: {other:?}"),
        }

        drop(held);
        assert_eq!(state_of(&slot).0, HelperStateName::Idle);
        assert!(slot.admit(&body("req-2"), ClientKind::Gui).is_ok());
    }

    #[test]
    fn the_slot_is_released_even_when_the_activation_unwinds() {
        let _fds = exclusive_fds();
        // A slot stranded in Activating would refuse every later TryActivate
        // with Busy for the rest of this process's lifetime.
        let (slot, _dir) = test_slot();
        let admitted = slot
            .admit(&body("req-1"), ClientKind::Gui)
            .expect("activation admitted");
        let unwound = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let _admitted = admitted;
            panic!("activation exploded");
        }));

        assert!(unwound.is_err(), "the activation was supposed to panic");
        assert_eq!(state_of(&slot).0, HelperStateName::Idle);
        assert!(slot.admit(&body("req-2"), ClientKind::Gui).is_ok());
    }

    #[test]
    fn status_probes_never_hold_the_lock() {
        let _fds = exclusive_fds();
        // A status probe takes LOCK_SH momentarily and releases it with the
        // fd; an admission immediately afterwards must succeed.
        let (slot, _dir) = test_slot();
        for _ in 0..3 {
            assert_eq!(state_of(&slot).0, HelperStateName::Idle);
        }
        assert!(slot.admit(&body("req-1"), ClientKind::Gui).is_ok());
    }

    // ------------------------------------------------------------------
    // The decision table.
    // ------------------------------------------------------------------

    fn decide<'slot>(
        slot: &'slot ActivationSlot,
        kind: ClientKind,
        line: &str,
    ) -> RequestAction<'slot> {
        decide_request(slot, kind, HELPER_BUILD, line)
    }

    fn reply_of(action: RequestAction<'_>) -> HelperReply {
        match action {
            RequestAction::Reply(reply) => reply,
            RequestAction::RunActivation { .. } => panic!("expected a reply, got an admission"),
        }
    }

    #[test]
    fn table_idle() {
        let (slot, _dir) = test_slot();

        assert!(matches!(
            reply_of(decide(&slot, ClientKind::Gui, &status_line())),
            HelperReply::Status {
                state: HelperStateName::Idle,
                activation: None,
                ..
            }
        ));

        assert!(matches!(
            decide(
                &slot,
                ClientKind::Gui,
                &try_activate_line(HELPER_BUILD, "req-1")
            ),
            RequestAction::RunActivation { .. }
        ));
    }

    #[test]
    fn table_activating() {
        let (slot, _dir) = test_slot();
        let _admitted = slot
            .admit(&body("req-1"), ClientKind::Gui)
            .expect("admitted");

        assert!(matches!(
            reply_of(decide(&slot, ClientKind::Gui, &status_line())),
            HelperReply::Status {
                state: HelperStateName::Activating,
                activation: Some(_),
                ..
            }
        ));
        assert!(matches!(
            reply_of(decide(
                &slot,
                ClientKind::SyncAgent,
                &try_activate_line(HELPER_BUILD, "req-2")
            )),
            HelperReply::Busy {
                activation: Some(_)
            }
        ));
    }

    #[test]
    fn a_request_that_does_not_parse_gets_request_not_understood() {
        let (slot, _dir) = test_slot();
        for line in [
            "not json",
            r#"{"kind":"selfDestruct"}"#,
            r#"{"op":"status"}"#,
            r#"{"kind":"tryActivate","buildId":"build-a","body":{"bogus":1}}"#,
        ] {
            assert!(
                matches!(
                    reply_of(decide(&slot, ClientKind::Gui, line)),
                    HelperReply::RequestNotUnderstood
                ),
                "line: {line:?}"
            );
        }
    }

    #[test]
    fn the_sync_agent_may_only_ask_for_an_activation() {
        let (slot, _dir) = test_slot();
        assert!(matches!(
            reply_of(decide(&slot, ClientKind::SyncAgent, &status_line())),
            HelperReply::CallerNotPermitted
        ));
        assert!(matches!(
            decide(
                &slot,
                ClientKind::SyncAgent,
                &try_activate_line(HELPER_BUILD, "req-1")
            ),
            RequestAction::RunActivation { .. }
        ));
    }

    #[test]
    fn an_unpermitted_caller_and_another_build_get_their_own_refusals() {
        let (slot, _dir) = test_slot();
        // Caller policy is decided before the build comparison.
        assert!(matches!(
            reply_of(decide(&slot, ClientKind::SyncAgent, &status_line())),
            HelperReply::CallerNotPermitted
        ));
        match reply_of(decide(
            &slot,
            ClientKind::Gui,
            &try_activate_line(OTHER_BUILD, "req-1"),
        )) {
            HelperReply::BuildMismatch { helper_build_id } => {
                assert_eq!(helper_build_id, HELPER_BUILD);
            }
            other => panic!("unexpected reply: {other:?}"),
        }
        // A mismatch never touches the slot.
        assert_eq!(state_of(&slot).0, HelperStateName::Idle);
    }

    #[test]
    fn an_empty_peer_build_id_is_a_build_mismatch_not_a_parse_failure() {
        let (slot, _dir) = test_slot();
        assert!(matches!(
            reply_of(decide(
                &slot,
                ClientKind::Gui,
                &try_activate_line("", "req-1")
            )),
            HelperReply::BuildMismatch { .. }
        ));
    }

    #[test]
    fn control_requests_are_answered_whatever_the_peers_build() {
        let (slot, _dir) = test_slot();
        // Status carries no build ID; a peer from any build gets an answer.
        assert!(matches!(
            reply_of(decide(
                &slot,
                ClientKind::Gui,
                r#"{"kind":"status","fieldFromAnotherBuild":true}"#
            )),
            HelperReply::Status { .. }
        ));
    }

    // ------------------------------------------------------------------
    // Connection semantics.
    // ------------------------------------------------------------------

    #[cfg(target_os = "macos")]
    fn test_config(kind: ClientKind) -> (Arc<ServeConfig>, tempfile::TempDir) {
        let (slot, dir) = test_slot();
        (
            Arc::new(ServeConfig {
                slot,
                helper_build_id: HELPER_BUILD.to_string(),
                authenticate: Box::new(move |stream| {
                    let identity = peer_auth::peer_identity(stream).ok()?;
                    Some(AuthedClient { identity, kind })
                }),
                run_activation: Box::new(|_, _, _| ActivationResult {
                    ok: true,
                    code: 0,
                    stdout: "activated".to_string(),
                    error: None,
                }),
            }),
            dir,
        )
    }

    #[cfg(target_os = "macos")]
    fn refusing_config() -> (Arc<ServeConfig>, tempfile::TempDir) {
        let (slot, dir) = test_slot();
        (
            Arc::new(ServeConfig {
                slot,
                helper_build_id: HELPER_BUILD.to_string(),
                authenticate: Box::new(|_| None),
                run_activation: Box::new(|_, _, _| {
                    unreachable!("no activation from a refused peer")
                }),
            }),
            dir,
        )
    }

    /// Sends one request line on a fresh connection and returns the reply.
    #[cfg(target_os = "macos")]
    fn request_on_new_connection(socket_path: &Path, line: &str) -> HelperReply {
        let client = UnixStream::connect(socket_path).expect("connect");
        client
            .set_read_timeout(Some(std::time::Duration::from_secs(10)))
            .expect("set timeout");
        (&client)
            .write_all(format!("{line}\n").as_bytes())
            .expect("write request");
        let mut reply = String::new();
        BufReader::new(&client)
            .read_line(&mut reply)
            .expect("read reply");
        HelperReply::parse(&reply).expect("reply parses")
    }

    /// Sends a raw request through the authenticated connection handler, then
    /// parses the newline-framed bytes exactly as a client does.
    #[cfg(target_os = "macos")]
    fn raw_request_through_wire(line: &str) -> HelperReply {
        let (client, server) = UnixStream::pair().expect("socketpair");
        let (config, _dir) = test_config(ClientKind::Gui);
        let handler = std::thread::spawn(move || serve_connection(server, &config));

        (&client)
            .write_all(format!("{line}\n").as_bytes())
            .expect("write request");
        let mut reply = String::new();
        BufReader::new(&client)
            .read_line(&mut reply)
            .expect("read reply");
        handler.join().expect("handler").expect("serves");
        HelperReply::parse(&reply).expect("client parses reply")
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn cross_build_control_requests_are_answered_through_the_real_wire_path() {
        // A GUI from another build asks with fields this build never heard of;
        // the answer must still come back on the wire.
        assert!(matches!(
            raw_request_through_wire(r#"{"kind":"status","fieldFromAnotherBuild":9999}"#),
            HelperReply::Status {
                state: HelperStateName::Idle,
                ..
            }
        ));
        assert!(matches!(
            raw_request_through_wire(r#"{"kind":"selfDestruct"}"#),
            HelperReply::RequestNotUnderstood
        ));

        // A TryActivate body from another build: syntactically valid JSON that
        // exceeds serde_json's materialization depth. It is a request this
        // build cannot parse, so it is not understood — the build ID it
        // carries is never reached, and nothing dispatches from the readable
        // prefix.
        let nested = format!("{}null{}", "[".repeat(150), "]".repeat(150));
        let future_body = format!(
            r#"{{"kind":"tryActivate","buildId":"{OTHER_BUILD}","body":{{"requestId":"req-future","scriptPath":"{SCRIPT}","future":{nested}}}}}"#
        );
        assert!(matches!(
            raw_request_through_wire(&future_body),
            HelperReply::RequestNotUnderstood
        ));

        // A well-formed request from another build does reach the comparison.
        assert!(matches!(
            raw_request_through_wire(&try_activate_line(OTHER_BUILD, "req-future")),
            HelperReply::BuildMismatch { .. }
        ));
    }

    /// A daemon over a real listener whose activation blocks until the
    /// returned gate is released — the fake long activation the concurrency
    /// obligations are stated against.
    #[cfg(target_os = "macos")]
    #[allow(clippy::type_complexity)]
    fn blocking_activation_daemon() -> (
        std::path::PathBuf,
        Arc<ServeConfig>,
        Arc<(Mutex<bool>, std::sync::Condvar)>,
        tempfile::TempDir,
    ) {
        let dir = tempfile::tempdir().expect("tempdir");
        let socket_path = dir.path().join("helper-test.sock");
        let listener = UnixListener::bind(&socket_path).expect("bind");
        let gate = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
        let runner_gate = Arc::clone(&gate);
        let config = Arc::new(ServeConfig {
            slot: ActivationSlot::at(dir.path().join("activation.lock")),
            helper_build_id: HELPER_BUILD.to_string(),
            authenticate: Box::new(|stream| {
                let identity = peer_auth::peer_identity(stream).ok()?;
                Some(AuthedClient {
                    identity,
                    kind: ClientKind::Gui,
                })
            }),
            run_activation: Box::new(move |_, _, _| {
                let (released, signal) = &*runner_gate;
                let mut released = released.lock().expect("gate");
                while !*released {
                    released = signal.wait(released).expect("gate wait");
                }
                ActivationResult {
                    ok: true,
                    code: 0,
                    stdout: "activated".to_string(),
                    error: None,
                }
            }),
        });
        let serving = Arc::clone(&config);
        std::thread::spawn(move || serve(listener, serving));
        (socket_path, config, gate, dir)
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn status_is_answered_while_an_activation_actually_runs() {
        let _fds = exclusive_fds();
        let (socket_path, config, gate, _dir) = blocking_activation_daemon();

        // Dispatch an activation that will not finish until released, on its
        // own connection, and wait until the slot really is occupied.
        let activation = std::thread::spawn({
            let socket_path = socket_path.clone();
            move || {
                request_on_new_connection(&socket_path, &try_activate_line(HELPER_BUILD, "req-1"))
            }
        });
        while state_of(&config.slot).0 != HelperStateName::Activating {
            std::thread::yield_now();
        }

        // Status is answered promptly and carries X.
        match request_on_new_connection(&socket_path, &status_line()) {
            HelperReply::Status {
                state: HelperStateName::Activating,
                activation: Some(info),
                ..
            } => assert_eq!(info.request_id, "req-1"),
            other => panic!("unexpected reply: {other:?}"),
        }

        // A second TryActivate is refused Busy with X, promptly.
        match request_on_new_connection(&socket_path, &try_activate_line(HELPER_BUILD, "req-2")) {
            HelperReply::Busy {
                activation: Some(info),
            } => assert_eq!(info.request_id, "req-1"),
            other => panic!("unexpected reply: {other:?}"),
        }

        // Releasing the activation delivers its result, and the slot is free
        // by the time the result is readable (transition-before-reply).
        {
            let (released, signal) = &*gate;
            *released.lock().expect("gate") = true;
            signal.notify_all();
        }
        let result = activation.join().expect("activation");
        assert!(matches!(
            result,
            HelperReply::ActivationResult(ActivationResult { ok: true, .. })
        ));
        assert_eq!(state_of(&config.slot).0, HelperStateName::Idle);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_connection_is_closed_after_the_reply() {
        let (client, server) = UnixStream::pair().expect("socketpair");
        let (config, _dir) = test_config(ClientKind::Gui);
        let handler = std::thread::spawn(move || serve_connection(server, &config));

        (&client)
            .write_all(format!("{}\n", status_line()).as_bytes())
            .expect("write request");
        let mut reply = String::new();
        let mut reader = BufReader::new(&client);
        reader.read_line(&mut reply).expect("read reply");
        assert!(matches!(
            HelperReply::parse(&reply).expect("reply parses"),
            HelperReply::Status { .. }
        ));

        // One reply, then the helper closes: the next read is end-of-file.
        let mut probe = String::new();
        assert_eq!(reader.read_line(&mut probe).expect("read eof"), 0);
        handler.join().expect("handler").expect("serves");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn invalid_utf8_gets_request_not_understood() {
        let (client, server) = UnixStream::pair().expect("socketpair");
        let (config, _dir) = test_config(ClientKind::Gui);
        let handler = std::thread::spawn(move || serve_connection(server, &config));

        (&client).write_all(b"\xff\n").expect("write invalid UTF-8");
        let mut reply = String::new();
        BufReader::new(&client)
            .read_line(&mut reply)
            .expect("read refusal");
        assert_eq!(
            reply,
            format!("{}\n", HelperReply::RequestNotUnderstood.encode())
        );
        handler.join().expect("handler").expect("serves");
    }

    #[test]
    fn a_connection_slot_is_released_even_when_its_thread_unwinds() {
        // A leaked slot never comes back for the process lifetime, and four
        // leaks would wedge the helper into refusing every connection — so
        // the slot must survive a panicking connection thread.
        let active = Arc::new(AtomicUsize::new(0));
        for _ in 0..MAX_CONCURRENT_CONNECTIONS * 3 {
            let slot = ConnectionSlot::acquire(&active).expect("a slot is free");
            let panicked = std::thread::spawn(move || {
                let _slot = slot;
                panic!("connection handling exploded");
            })
            .join();

            assert!(panicked.is_err(), "the thread was supposed to panic");
            assert_eq!(active.load(Ordering::Acquire), 0, "slot was not released");
        }
    }

    #[test]
    fn slots_are_handed_out_up_to_the_cap_and_no_further() {
        let active = Arc::new(AtomicUsize::new(0));
        let held: Vec<ConnectionSlot> = (0..MAX_CONCURRENT_CONNECTIONS)
            .map(|_| ConnectionSlot::acquire(&active).expect("a slot is free"))
            .collect();

        assert!(ConnectionSlot::acquire(&active).is_none());

        drop(held);
        assert!(ConnectionSlot::acquire(&active).is_some());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn unauthenticated_peer_is_closed_before_any_protocol_bytes() {
        let (client, server) = UnixStream::pair().expect("socketpair");
        let (config, _dir) = refusing_config();
        let handler = std::thread::spawn(move || serve_connection(server, &config));

        // The peer never even sends a request; the close must come first.
        let mut probe = [0u8; 8];
        assert_eq!((&client).read(&mut probe).expect("read"), 0);
        handler.join().expect("handler").expect("serves");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn oversized_valid_prefix_is_refused_as_request_not_understood() {
        let (client, server) = UnixStream::pair().expect("socketpair");
        let (config, _dir) = test_config(ClientKind::Gui);
        let handler = std::thread::spawn(move || serve_connection(server, &config));

        // The first MAX_REQUEST_BYTES bytes are a valid Status envelope plus
        // JSON whitespace. Accepting that prefix before reading the suffix
        // would dispatch an oversized, incomplete frame.
        let mut oversized = status_line().into_bytes();
        oversized.resize(MAX_REQUEST_BYTES as usize, b' ');
        oversized.extend_from_slice(b"x\n");
        (&client).write_all(&oversized).expect("write");

        let mut reply = String::new();
        BufReader::new(&client)
            .read_line(&mut reply)
            .expect("read reply");
        assert!(matches!(
            HelperReply::parse(&reply).expect("reply parses"),
            HelperReply::RequestNotUnderstood
        ));
        handler.join().expect("handler").expect("serves");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn connections_past_the_cap_are_closed_without_protocol_bytes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let socket_path = dir.path().join("helper-test.sock");
        let listener = UnixListener::bind(&socket_path).expect("bind");
        let (config, _slot_dir) = test_config(ClientKind::Gui);
        std::thread::spawn(move || serve(listener, config));

        // Fill every slot with connections that have not sent a request yet:
        // each occupies its slot until it closes (the helper now closes
        // answered connections itself, so only unanswered ones can hold a
        // slot open from outside).
        let held: Vec<UnixStream> = (0..MAX_CONCURRENT_CONNECTIONS)
            .map(|_| UnixStream::connect(&socket_path).expect("connect"))
            .collect();
        // Give the accept loop a moment to hand every held connection to a
        // handler thread.
        std::thread::sleep(std::time::Duration::from_millis(100));

        // The (cap+1)th connection is accepted and closed before any bytes.
        let extra = UnixStream::connect(&socket_path).expect("connect");
        extra
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .expect("set timeout");
        let mut probe = [0u8; 8];
        assert_eq!((&extra).read(&mut probe).expect("read"), 0);
        drop(held);
    }

    // ------------------------------------------------------------------
    // The detached runner (real forks, fake activations).
    // ------------------------------------------------------------------

    fn shell_argv(script: &str) -> Vec<String> {
        vec!["/bin/sh".to_string(), "-c".to_string(), script.to_string()]
    }

    #[test]
    fn the_runner_executes_the_command_and_reports_its_exit_and_output() {
        let _fds = exclusive_fds();
        let dir = tempfile::tempdir().expect("tempdir");
        let log_path = dir.path().join("activation.log");
        let lock = open_lock_file(&dir.path().join("activation.lock")).expect("lock");
        assert!(try_flock(&lock, libc::LOCK_EX).expect("flock"));

        let (code, output) = spawn_runner(
            &shell_argv("echo to-stdout; echo to-stderr 1>&2; exit 3"),
            None,
            &log_path,
            lock.as_fd(),
        )
        .expect("runner completes");

        assert_eq!(code, 3);
        assert!(output.contains("to-stdout"));
        assert!(output.contains("to-stderr"), "stderr merged into the log");
    }

    #[test]
    fn a_straggler_left_by_the_activation_does_not_hold_the_lock() {
        let _fds = exclusive_fds();
        // The CLOEXEC discipline: the lock fd dies at the activation
        // command's exec, so a background process the script leaves behind
        // cannot hold the slot after the runner exits.
        let dir = tempfile::tempdir().expect("tempdir");
        let lock_path = dir.path().join("activation.lock");
        let log_path = dir.path().join("activation.log");
        let lock = open_lock_file(&lock_path).expect("lock");
        assert!(try_flock(&lock, libc::LOCK_EX).expect("flock"));

        let (code, _output) = spawn_runner(
            &shell_argv("sleep 30 & echo spawned"),
            None,
            &log_path,
            lock.as_fd(),
        )
        .expect("runner completes");
        assert_eq!(code, 0);

        // This process still holds its own fd; release it, then prove the
        // lock is free even though the straggler sleep is still alive.
        drop(lock);
        let probe = open_lock_file(&lock_path).expect("probe open");
        assert!(
            try_flock(&probe, libc::LOCK_EX).expect("probe flock"),
            "a straggler inherited the activation lock"
        );
    }

    #[test]
    fn a_failed_profile_update_writes_the_warning_and_keeps_the_success() {
        let _fds = exclusive_fds();
        let dir = tempfile::tempdir().expect("tempdir");
        let log_path = dir.path().join("activation.log");
        let lock = open_lock_file(&dir.path().join("activation.lock")).expect("lock");
        assert!(try_flock(&lock, libc::LOCK_EX).expect("flock"));

        let (code, output) = spawn_runner(
            &shell_argv("echo activated"),
            Some(&["/usr/bin/false".to_string()]),
            &log_path,
            lock.as_fd(),
        )
        .expect("runner completes");

        assert_eq!(code, 0, "profile maintenance never fails the activation");
        assert!(output.contains("activated"));
        assert!(output.contains(HELPER_WARNING_PREFIX));
    }

    #[test]
    fn a_missing_profile_updater_writes_the_warning_too() {
        let _fds = exclusive_fds();
        let dir = tempfile::tempdir().expect("tempdir");
        let log_path = dir.path().join("activation.log");
        let lock = open_lock_file(&dir.path().join("activation.lock")).expect("lock");
        assert!(try_flock(&lock, libc::LOCK_EX).expect("flock"));

        let (code, output) =
            spawn_runner(&shell_argv("echo activated"), None, &log_path, lock.as_fd())
                .expect("runner completes");

        assert_eq!(code, 0);
        assert!(output.contains(HELPER_WARNING_PREFIX));
    }

    #[test]
    fn a_signal_killed_activation_reports_128_plus_signal() {
        let _fds = exclusive_fds();
        let dir = tempfile::tempdir().expect("tempdir");
        let log_path = dir.path().join("activation.log");
        let lock = open_lock_file(&dir.path().join("activation.lock")).expect("lock");
        assert!(try_flock(&lock, libc::LOCK_EX).expect("flock"));

        let (code, _output) =
            spawn_runner(&shell_argv("kill -TERM $$"), None, &log_path, lock.as_fd())
                .expect("runner completes");

        assert_eq!(code, 128 + libc::SIGTERM);
    }

    #[test]
    fn the_reply_carries_a_capped_log_tail() {
        let _fds = exclusive_fds();
        let dir = tempfile::tempdir().expect("tempdir");
        let log_path = dir.path().join("activation.log");
        let lock = open_lock_file(&dir.path().join("activation.lock")).expect("lock");
        assert!(try_flock(&lock, libc::LOCK_EX).expect("flock"));

        // Write well past the cap, ending in a recognizable line.
        let script =
            "i=0; while [ $i -lt 700 ]; do printf '%01024d\\n' $i; i=$((i+1)); done; echo THE-END";
        let (code, output) = spawn_runner(&shell_argv(script), None, &log_path, lock.as_fd())
            .expect("runner completes");

        assert_eq!(code, 0);
        assert!(output.len() as u64 <= REPLY_LOG_TAIL_BYTES + 1024);
        assert!(output.starts_with(LOG_TRUNCATION_MARKER));
        // The script's last line survives the cap; the missing-profile
        // warning lands after it (no nix-env in the test environment).
        assert!(output.contains("THE-END\n"));
        assert!(
            output
                .trim_end()
                .ends_with("failed to update system profile")
        );
        // The file itself keeps everything.
        let full = fs::metadata(&log_path).expect("log metadata").len();
        assert!(full > REPLY_LOG_TAIL_BYTES);
    }

    // ------------------------------------------------------------------
    // Peer policy (unchanged) and activation hardening (unchanged).
    // ------------------------------------------------------------------

    #[test]
    fn peer_policy_rejects_root_peer() {
        assert!(check_peer_policy(0, Some(501)).is_err());
    }

    #[test]
    fn peer_policy_rejects_uid_not_matching_console_user() {
        assert!(check_peer_policy(502, Some(501)).is_err());
    }

    #[test]
    fn peer_policy_rejects_when_no_console_user() {
        assert!(check_peer_policy(501, None).is_err());
    }

    #[test]
    fn peer_policy_accepts_console_user_peer() {
        assert!(check_peer_policy(501, Some(501)).is_ok());
    }

    fn account() -> UserAccount {
        UserAccount {
            name: "peer-alice".to_string(),
            home: "/Users/peer-alice".to_string(),
        }
    }

    #[test]
    fn activation_argv_execs_directly_with_fixed_path_and_derived_account() {
        let argv = activation_argv(
            501,
            &account(),
            "/nix/store/abc123-darwin-system-25.05.20260629/activate",
        );

        assert_eq!(argv[0], "/bin/launchctl");
        assert_eq!(&argv[1..3], ["asuser", "501"]);
        assert_eq!(&argv[3..5], ["/usr/bin/env", "-i"]);
        assert!(argv.contains(&format!("PATH={ACTIVATION_PATH_ENV}")));
        // Account values come from the peer lookup. The protocol has no
        // fields for a client to claim these with.
        assert!(argv.contains(&"HOME=/Users/peer-alice".to_string()));
        assert!(argv.contains(&"USER=peer-alice".to_string()));
        assert_eq!(
            argv.last().map(String::as_str),
            Some("/nix/store/abc123-darwin-system-25.05.20260629/activate")
        );
    }

    #[test]
    fn activation_argv_never_builds_shell_sudoers_or_agent_access() {
        let argv = activation_argv(
            501,
            &account(),
            "/nix/store/abc123-darwin-system-25.05.20260629/activate",
        );

        assert!(!argv.iter().any(|arg| arg.contains("/bin/sh")));
        assert!(!argv.iter().any(|arg| arg.contains("sudo")));
        assert!(!argv.iter().any(|arg| arg.contains("sudoers")));
        // The privileged activation deliberately receives no capability to
        // reach a user's SSH agent.
        assert!(!argv.iter().any(|arg| arg.starts_with("SSH_AUTH_SOCK=")));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn activation_argv_derives_from_the_authenticated_peer_account() {
        // The peer identity of a socketpair end is this test process, so the
        // argv must carry this process's uid and its user-database account —
        // the lookup keys on the authenticated uid and nothing else.
        let (stream, _other_end) = UnixStream::pair().expect("socketpair");
        let peer = peer_auth::peer_identity(&stream).expect("peer identity");
        let me = nix::unistd::User::from_uid(nix::unistd::Uid::from_raw(peer.euid))
            .expect("user lookup")
            .expect("account exists");

        let argv = activation_argv_for_peer(&peer, "/nix/store/abc-darwin-system/activate")
            .expect("argv for peer");

        assert_eq!(argv[1], "asuser");
        assert_eq!(argv[2], peer.euid.to_string());
        assert!(argv.contains(&format!("USER={}", me.name)));
        assert!(argv.contains(&format!("HOME={}", me.dir.display())));
    }

    #[test]
    fn component_policy_accepts_root_owned_unwritable_components() {
        let path = Path::new("/nix");
        assert!(check_component_policy(path, 0, 0o755, true).is_ok());
        assert!(check_component_policy(path, 0, 0o555, false).is_ok());
    }

    #[test]
    fn component_policy_accepts_sticky_group_writable_store_dir() {
        // The standard multi-user store: drwxrwxr-t root:nixbld.
        assert!(check_component_policy(Path::new("/nix/store"), 0, 0o1775, true).is_ok());
    }

    #[test]
    fn component_policy_rejects_non_root_owner() {
        let error =
            check_component_policy(Path::new("/nix/store/item"), 501, 0o755, true).unwrap_err();

        assert!(error.to_string().contains("not root"));
    }

    #[test]
    fn component_policy_rejects_group_writable_without_sticky() {
        assert!(check_component_policy(Path::new("/nix"), 0, 0o775, true).is_err());
        // The sticky exception applies to directories only, never to the
        // activate executable itself.
        let file = Path::new("/nix/store/item/activate");
        assert!(check_component_policy(file, 0, 0o1775, false).is_err());
    }

    #[test]
    fn component_policy_limits_sticky_exception_to_the_store_root() {
        // Group members can create entries in any sticky group-writable
        // directory, so a 1775 store *item* is not immutable — only the
        // store root itself gets the exception.
        let item = Path::new("/nix/store/item");
        assert!(check_component_policy(item, 0, 0o1775, true).is_err());
    }

    #[test]
    fn component_policy_rejects_world_writable_even_with_sticky() {
        // A /tmp-shaped directory (drwxrwxrwt) must never pass.
        assert!(check_component_policy(Path::new("/tmp"), 0, 0o1777, true).is_err());
    }

    #[test]
    fn component_metadata_rejects_symlinks() {
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("target");
        fs::create_dir(&target).expect("create target dir");
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&target, &link).expect("create symlink");

        let metadata = fs::symlink_metadata(&link).expect("lstat link");
        let error = check_component_metadata(&link, &metadata, false).unwrap_err();

        assert!(error.to_string().contains("symlink"));
    }

    #[test]
    fn component_metadata_rejects_non_executable_or_non_file_target() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("activate");
        fs::write(&file, "#!/bin/sh\n").expect("write file");
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).expect("chmod");

        let metadata = fs::symlink_metadata(&file).expect("lstat file");
        let error = check_component_metadata(&file, &metadata, true).unwrap_err();
        assert!(error.to_string().contains("not executable"));

        let dir_metadata = fs::symlink_metadata(dir.path()).expect("lstat dir");
        let error = check_component_metadata(dir.path(), &dir_metadata, true).unwrap_err();
        assert!(error.to_string().contains("not a regular file"));
    }

    #[test]
    fn activation_walk_rejects_requester_writable_tree() {
        // A tempdir tree is owned by the (non-root) test user — exactly what
        // the walk exists to reject. Canonicalized first so the macOS /var
        // symlink does not short-circuit the walk before the ownership check.
        let dir = tempfile::tempdir().expect("tempdir");
        let item = dir
            .path()
            .canonicalize()
            .expect("canonicalize")
            .join("item");
        fs::create_dir(&item).expect("create item dir");
        let activate = item.join("activate");
        fs::write(&activate, "#!/bin/sh\n").expect("write activate");
        fs::set_permissions(&activate, fs::Permissions::from_mode(0o755)).expect("chmod");

        let error = check_activation_path_unwritable(&activate).unwrap_err();

        // macOS tempdirs live under /var/folders and trip the ownership
        // check; on Linux the walk crosses /tmp (1777 root) first and trips
        // the world-writable check. Either way the requester-writable tree
        // is rejected.
        let message = error.to_string();
        assert!(
            message.contains("not root") || message.contains("world-writable"),
            "unexpected rejection: {message}"
        );
    }

    #[test]
    fn canonical_target_rejects_non_store_and_missing_paths() {
        assert!(canonical_activation_target("/tmp/activate").is_err());
        assert!(canonical_activation_target("/nix/store/no-such-item-c1-test/activate").is_err());
    }
}
