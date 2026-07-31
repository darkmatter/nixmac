use crate::privileged_helper::peer_auth::{self, ClientKind, ClientValidation, PeerIdentity};
use crate::privileged_helper::protocol::{
    ActivationInfo, ActivationResult, BUILD_ID, HELPER_SOCKET_DIR, HELPER_SOCKET_PATH,
    HELPER_WARNING_PREFIX, HelperReply, HelperRequest, HelperStateName, TryActivateBody,
    validate_canonical_activate_path,
};
use anyhow::{Context, Result, anyhow, bail};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

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

// ---------------------------------------------------------------------------
// The single-slot state machine — the helper's one stateful center.
// ---------------------------------------------------------------------------

/// The four states, one per `HelperStateName`. Process-lifetime only — nothing
/// here is persisted, so a relaunched helper starts `Idle`.
#[derive(Debug, Clone)]
enum SlotState {
    Idle,
    Activating(ActivationInfo),
    /// X is still running and retirement is latched: this helper will never
    /// start another activation.
    Retiring(ActivationInfo),
    /// No activation is running and this helper will never start another.
    Retired,
}

impl SlotState {
    fn name(&self) -> HelperStateName {
        match self {
            SlotState::Idle => HelperStateName::Idle,
            SlotState::Activating(_) => HelperStateName::Activating,
            SlotState::Retiring(_) => HelperStateName::Retiring,
            SlotState::Retired => HelperStateName::Retired,
        }
    }

    fn activation(&self) -> Option<ActivationInfo> {
        match self {
            SlotState::Activating(activation) | SlotState::Retiring(activation) => {
                Some(activation.clone())
            }
            SlotState::Idle | SlotState::Retired => None,
        }
    }
}

/// The single slot: one activation at a time, and the only state this process
/// keeps.
///
/// A private mutex guards the state, and each operation below is one bounded
/// in-memory transition. The guard and the state itself never escape, and the
/// lock is never held across activation, authentication, protocol encoding,
/// socket I/O, reply writing, or any other external work — so `Status` and
/// `Retire` stay prompt in every state, including while an activation runs.
///
/// There is deliberately no queue: a request that cannot be served now is
/// refused with a typed reply, never parked.
pub(crate) struct ActivationSlot {
    state: Mutex<SlotState>,
}

impl ActivationSlot {
    pub(crate) fn new() -> Self {
        Self {
            state: Mutex::new(SlotState::Idle),
        }
    }

    /// Every mutation below is a whole-value assignment, so recovery from a
    /// poisoned mutex still observes one of the four states.
    fn lock(&self) -> std::sync::MutexGuard<'_, SlotState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// An owned view: the state's name and X, if one is running.
    fn snapshot(&self) -> (HelperStateName, Option<ActivationInfo>) {
        let state = self.lock();
        (state.name(), state.activation())
    }

    fn status_reply(&self, helper_build_id: &str) -> HelperReply {
        let (state, activation) = self.snapshot();
        HelperReply::Status {
            state,
            helper_build_id: helper_build_id.to_string(),
            activation,
        }
    }

    /// The `Retire` transition. It takes effect before the reply that reports
    /// it: a `Retired` reply is built only after the state is already
    /// `Retired`, so no concurrent request can be admitted after it. During an
    /// activation, retirement latches and the reply is `Busy(X)`.
    fn retire(&self) -> HelperReply {
        let mut state = self.lock();
        match &*state {
            SlotState::Idle => {
                *state = SlotState::Retired;
                HelperReply::Retired { activation: None }
            }
            SlotState::Activating(activation) => {
                let activation = activation.clone();
                *state = SlotState::Retiring(activation.clone());
                HelperReply::Busy { activation }
            }
            // Already latched: X is still running, so still not safe to
            // unregister.
            SlotState::Retiring(activation) => HelperReply::Busy {
                activation: activation.clone(),
            },
            SlotState::Retired => HelperReply::Retired { activation: None },
        }
    }

    /// `TryActivate` admission: `Ok` carries the permit proving the state is
    /// already `Activating(X)`; `Err` is the immediate state-derived refusal.
    /// The decision and the transition are one atomic step serialized across
    /// all connections. X's client kind is stamped from the helper's own
    /// validation of the submitting client, never from the request body.
    fn admit<'slot>(
        &'slot self,
        body: &TryActivateBody,
        client_kind: ClientKind,
    ) -> std::result::Result<ActivationPermit<'slot>, HelperReply> {
        let mut state = self.lock();
        match &*state {
            SlotState::Idle => {
                *state = SlotState::Activating(ActivationInfo {
                    request_id: body.request_id.clone(),
                    script_path: body.script_path.clone(),
                    client_kind,
                });
                // The permit outlives this call; the lock does not.
                drop(state);
                Ok(ActivationPermit { slot: self })
            }
            SlotState::Activating(activation) => Err(HelperReply::Busy {
                activation: activation.clone(),
            }),
            // The deliberate latched-state asymmetry: a retiring helper tells
            // `TryActivate` it is (about to be) retired — permanent for this
            // process — carrying X while it finishes.
            SlotState::Retiring(activation) => Err(HelperReply::Retired {
                activation: Some(activation.clone()),
            }),
            SlotState::Retired => Err(HelperReply::Retired { activation: None }),
        }
    }

    /// Leaves `Activating`/`Retiring` when the admitted activation ends. Only
    /// [`ActivationPermit`]'s drop calls this.
    fn finish_activation(&self) {
        let mut state = self.lock();
        match &*state {
            SlotState::Activating(_) => *state = SlotState::Idle,
            // A latched retirement wins over the activation ending, unwinding
            // included: the helper must not come back activatable after a
            // `Retire` it already acknowledged.
            SlotState::Retiring(_) => *state = SlotState::Retired,
            SlotState::Idle | SlotState::Retired => {}
        }
    }
}

/// Proof that this request owns the single activation slot. It is constructed
/// only by successful admission and guarantees the finish transition on every
/// exit path, including unwind.
struct ActivationPermit<'slot> {
    slot: &'slot ActivationSlot,
}

impl ActivationPermit<'_> {
    /// Consumes the permit — which destroys it, performing the transition —
    /// and only then builds the reply reporting the activation's end. The
    /// explicit `drop` is load-bearing: left implicit, `self` would fall out
    /// of scope *after* the tail expression built the reply.
    ///
    /// Two separate things keep the contract's transition-before-the-reply,
    /// and neither is the type system: this is the only place the helper
    /// constructs an `ActivationResult` reply (`HelperReply` is an ordinary
    /// public enum — keeping it the only place is a review rule), and the
    /// permit is scoped to `serve_connection`'s activation arm, so its
    /// destructor runs before any byte of the reply is written whatever that
    /// arm does.
    fn into_result_reply(self, result: ActivationResult) -> HelperReply {
        drop(self);
        HelperReply::ActivationResult(result)
    }
}

impl Drop for ActivationPermit<'_> {
    fn drop(&mut self) {
        self.slot.finish_activation();
    }
}

// ---------------------------------------------------------------------------
// Request handling.
// ---------------------------------------------------------------------------

enum RequestAction<'slot> {
    /// Reply immediately; any state transition it reports already happened.
    Reply(HelperReply),
    /// Admitted: the slot is `Activating(X)`; the caller runs the
    /// activation, lets the slot transition out of `Activating`, and only
    /// then sends the result reply.
    RunActivation {
        body: TryActivateBody,
        permit: ActivationPermit<'slot>,
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
/// state-based reply. `Status` and `Retire` carry no build ID and are answered
/// in every state.
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
        HelperRequest::Retire => RequestAction::Reply(slot.retire()),
        HelperRequest::TryActivate { build_id, body } => {
            if build_id != helper_build_id {
                return RequestAction::Reply(HelperReply::BuildMismatch {
                    helper_build_id: helper_build_id.to_string(),
                });
            }
            match slot.admit(&body, client_kind) {
                Ok(permit) => RequestAction::RunActivation { body, permit },
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
type ActivationRunner = dyn Fn(&AuthedClient, &TryActivateBody) -> ActivationResult + Send + Sync;

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
/// request, reply, then leave the connection open and ignore further bytes
/// until the peer closes it. The helper never closes an authenticated
/// connection.
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
            // The authenticated peer receives the frozen refusal and the helper
            // then follows the normal keep-open/ignore path below.
            Err(_) => RequestAction::Reply(HelperReply::RequestNotUnderstood),
        },
        // A missing terminator or a line beyond the existing cap is an
        // unreadable request. Never dispatch from a valid-looking prefix.
        RequestFrame::Malformed => RequestAction::Reply(HelperReply::RequestNotUnderstood),
    };
    let reply = match action {
        RequestAction::Reply(reply) => reply,
        RequestAction::RunActivation { body, permit } => {
            let result = (config.run_activation)(&client, &body);
            permit.into_result_reply(result)
        }
    };
    stream.write_all(reply.encode().as_bytes())?;
    stream.write_all(b"\n")?;
    stream.flush()?;

    ignore_further_bytes(stream);
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

/// Post-reply: the connection stays open (the peer may hold it as a liveness
/// signal) and every further byte is discarded until the peer closes. Only a
/// peer-side close ends this loop — a signal-interrupted read must not, or
/// the helper would close an authenticated connection and forge the very
/// signal a client reads as "the helper process ended".
fn ignore_further_bytes(mut stream: UnixStream) {
    let mut sink = [0u8; 1024];
    loop {
        match stream.read(&mut sink) {
            Ok(0) => return,
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => return,
        }
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
            run_activation: Box::new(|client, body| {
                run_activation_for_client(&client.identity, body)
            }),
        }),
    )
}

fn harden_socket_permissions(socket_path: &Path) -> Result<()> {
    let admin_gid = admin_group_id();
    if let Some(console_uid) = peer_auth::console_user_uid() {
        let _ = std::os::unix::fs::chown(socket_path, Some(console_uid), admin_gid);
        fs::set_permissions(socket_path, fs::Permissions::from_mode(0o600))?;
    } else {
        let _ = std::os::unix::fs::chown(socket_path, Some(0), admin_gid);
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
/// Note the breadth deliberately: this gate covers `Status` and `Retire` too,
/// not just activation, and it runs *before* signature validation — a peer
/// failing it is closed without protocol bytes rather than answered with a
/// typed refusal. That is narrower than the published helper contract, which
/// scopes user-level policy to activation alone and would have a
/// signature-valid non-console peer authenticated and answered. Narrower is
/// the conservative direction, and it is what the socket's own permissions
/// already imply (the socket is mode 0600 owned by the console user, so a
/// second login session cannot reach it at all). Consequences worth knowing
/// before widening or narrowing this: a second-session GUI reports and defers
/// instead of converging, and the contract's residual risk about `Retire`
/// being accepted from any local signature-valid copy is correspondingly
/// smaller. Changing the socket's ownership or mode is a separate piece of
/// work; do not scope this gate down without it.
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
// Activation execution (unchanged hardening rules).
// ---------------------------------------------------------------------------

/// Runs one admitted activation to completion and folds every failure into
/// the result reply, so an activation that could not run still reports an
/// outcome rather than unwinding. (Leaving the `Activating` state does not
/// depend on that: `ActivationPermit` covers the unwinding path too.)
fn run_activation_for_client(peer: &PeerIdentity, body: &TryActivateBody) -> ActivationResult {
    match activate_script_path(peer, &body.script_path) {
        Ok(result) => result,
        Err(error) => ActivationResult {
            ok: false,
            code: -1,
            stdout: String::new(),
            error: Some(format!("{error:#}")),
        },
    }
}

fn activate_script_path(peer: &PeerIdentity, script_path: &str) -> Result<ActivationResult> {
    let activate_path = canonical_activation_target(script_path)?;
    let argv = activation_argv_for_peer(peer, &activate_path)?;
    let (status, mut stdout) = run_activation_command(&argv)?;

    // Profile maintenance runs only after a successful activation and is
    // best-effort: the system switch already happened, so its failures
    // surface as warnings instead of failing the apply.
    if status.success() {
        for warning in post_activation_maintenance(&activate_path) {
            stdout.push_str(&format!("\n{HELPER_WARNING_PREFIX} {warning}"));
        }
    }

    Ok(ActivationResult {
        ok: status.success(),
        code: status.code().unwrap_or(-1),
        stdout,
        error: None,
    })
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

/// Runs a prepared activation argv with stderr merged into stdout (the old
/// script's `2>&1`): consumers stream, log, and summarize a single output
/// stream, and the activate script writes most of its output to stderr.
/// Shared by the helper daemon and the interactive fallback's root re-entry
/// (`privileged_helper::root_activation`).
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

pub(crate) fn post_activation_maintenance(activate_path: &str) -> Vec<String> {
    let mut warnings = Vec::new();
    if let Err(error) = set_system_profile(activate_path) {
        warnings.push(format!("failed to update system profile: {error:#}"));
    }
    warnings
}

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
    use std::sync::Barrier;

    // Build IDs identify a build and are only ever compared, so the tests use
    // values that are deliberately not commit-shaped.
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

    fn retire_line() -> String {
        HelperRequest::Retire.encode()
    }

    fn try_activate_line(build_id: &str, request_id: &str) -> String {
        HelperRequest::TryActivate {
            build_id: build_id.to_string(),
            body: body(request_id),
        }
        .encode()
    }

    fn decide<'slot>(
        slot: &'slot ActivationSlot,
        kind: ClientKind,
        line: &str,
    ) -> RequestAction<'slot> {
        decide_request(slot, kind, HELPER_BUILD, line)
    }

    fn state_of(slot: &ActivationSlot) -> HelperStateName {
        slot.snapshot().0
    }

    fn reply_of(action: RequestAction<'_>) -> HelperReply {
        match action {
            RequestAction::Reply(reply) => reply,
            RequestAction::RunActivation { .. } => panic!("expected a reply, got an admission"),
        }
    }

    fn activation_info() -> ActivationInfo {
        ActivationInfo {
            request_id: "req-1".to_string(),
            script_path: SCRIPT.to_string(),
            client_kind: ClientKind::Gui,
        }
    }

    /// Builds the state needed to test occupied-slot replies without creating
    /// a permit whose borrow would prevent returning the slot.
    fn activating_slot() -> ActivationSlot {
        ActivationSlot {
            state: Mutex::new(SlotState::Activating(activation_info())),
        }
    }

    /// Puts a slot into `Retiring(X)`.
    fn retiring_slot() -> ActivationSlot {
        let slot = activating_slot();
        assert!(matches!(
            reply_of(decide(&slot, ClientKind::Gui, &retire_line())),
            HelperReply::Busy { .. }
        ));
        slot
    }

    /// Puts a slot into `Retired`.
    fn retired_slot() -> ActivationSlot {
        let slot = ActivationSlot::new();
        assert!(matches!(
            reply_of(decide(&slot, ClientKind::Gui, &retire_line())),
            HelperReply::Retired { activation: None }
        ));
        slot
    }

    // ------------------------------------------------------------------
    // The full request × state table.
    // ------------------------------------------------------------------

    #[test]
    fn table_idle() {
        let slot = ActivationSlot::new();
        match reply_of(decide(&slot, ClientKind::Gui, &status_line())) {
            HelperReply::Status {
                state: HelperStateName::Idle,
                helper_build_id,
                activation: None,
            } => assert_eq!(helper_build_id, HELPER_BUILD),
            other => panic!("unexpected reply: {other:?}"),
        }

        // TryActivate from Idle: admitted, state becomes Activating(X).
        let slot = ActivationSlot::new();
        let admission = decide(
            &slot,
            ClientKind::Gui,
            &try_activate_line(HELPER_BUILD, "req-1"),
        );
        assert!(matches!(&admission, RequestAction::RunActivation { .. }));
        assert_eq!(state_of(&slot), HelperStateName::Activating);
        drop(admission);

        // Retire from Idle: state becomes Retired, then the reply reports it.
        let slot = ActivationSlot::new();
        assert!(matches!(
            reply_of(decide(&slot, ClientKind::Gui, &retire_line())),
            HelperReply::Retired { activation: None }
        ));
        assert_eq!(state_of(&slot), HelperStateName::Retired);
    }

    #[test]
    fn table_activating() {
        // Status names the state and carries X.
        let slot = activating_slot();
        match reply_of(decide(&slot, ClientKind::Gui, &status_line())) {
            HelperReply::Status {
                state: HelperStateName::Activating,
                activation: Some(activation),
                ..
            } => {
                assert_eq!(activation.request_id, "req-1");
                assert_eq!(activation.script_path, SCRIPT);
                assert_eq!(activation.client_kind, ClientKind::Gui);
            }
            other => panic!("unexpected reply: {other:?}"),
        }

        // TryActivate: Busy(X).
        match reply_of(decide(
            &slot,
            ClientKind::SyncAgent,
            &try_activate_line(HELPER_BUILD, "req-2"),
        )) {
            HelperReply::Busy { activation } => assert_eq!(activation.request_id, "req-1"),
            other => panic!("unexpected reply: {other:?}"),
        }

        // Retire: retirement latches, reply Busy(X).
        match reply_of(decide(&slot, ClientKind::Gui, &retire_line())) {
            HelperReply::Busy { activation } => assert_eq!(activation.request_id, "req-1"),
            other => panic!("unexpected reply: {other:?}"),
        }
        assert_eq!(state_of(&slot), HelperStateName::Retiring);
    }

    #[test]
    fn table_retiring_asymmetries() {
        // The two deliberate asymmetries while retirement is latched:
        // TryActivate gets Retired (carrying X while it finishes), Retire gets
        // Busy(X).
        let slot = retiring_slot();

        match reply_of(decide(
            &slot,
            ClientKind::Gui,
            &try_activate_line(HELPER_BUILD, "req-2"),
        )) {
            HelperReply::Retired {
                activation: Some(activation),
            } => assert_eq!(activation.request_id, "req-1"),
            other => panic!("unexpected reply: {other:?}"),
        }

        match reply_of(decide(&slot, ClientKind::Gui, &retire_line())) {
            HelperReply::Busy { activation } => assert_eq!(activation.request_id, "req-1"),
            other => panic!("unexpected reply: {other:?}"),
        }

        // Status names the state verbatim and still carries X.
        assert!(matches!(
            reply_of(decide(&slot, ClientKind::Gui, &status_line())),
            HelperReply::Status {
                state: HelperStateName::Retiring,
                activation: Some(_),
                ..
            }
        ));
        assert_eq!(state_of(&slot), HelperStateName::Retiring);
    }

    #[test]
    fn table_retired() {
        let slot = retired_slot();

        assert!(matches!(
            reply_of(decide(&slot, ClientKind::Gui, &status_line())),
            HelperReply::Status {
                state: HelperStateName::Retired,
                activation: None,
                ..
            }
        ));
        assert!(matches!(
            reply_of(decide(
                &slot,
                ClientKind::Gui,
                &try_activate_line(HELPER_BUILD, "req-2")
            )),
            HelperReply::Retired { activation: None }
        ));
        assert!(matches!(
            reply_of(decide(&slot, ClientKind::Gui, &retire_line())),
            HelperReply::Retired { activation: None }
        ));
    }

    // ------------------------------------------------------------------
    // Refusal order, caller policy, and cross-build tolerance.
    // ------------------------------------------------------------------

    #[test]
    fn a_request_that_does_not_parse_gets_request_not_understood() {
        let slot = ActivationSlot::new();
        for line in [
            "",
            "garbage",
            // A shape a previous release put on this socket.
            r#"{"op":"status"}"#,
            // A kind outside the closed set.
            r#"{"kind":"selfDestruct"}"#,
            // A TryActivate whose body this build does not honor: the request
            // is parsed as a whole, so a malformed body is a malformed
            // request. There is deliberately no promise that a build mismatch
            // is noticed first.
            r#"{"kind":"tryActivate","buildId":"build-a"}"#,
            r#"{"kind":"tryActivate","buildId":"build-a","body":{"somethingElse":1}}"#,
            r#"{"kind":"tryActivate","buildId":"build-b","body":{"futureField":true}}"#,
        ] {
            assert!(
                matches!(
                    reply_of(decide(&slot, ClientKind::Gui, line)),
                    HelperReply::RequestNotUnderstood
                ),
                "line: {line:?}"
            );
        }
        assert_eq!(state_of(&slot), HelperStateName::Idle);
    }

    #[test]
    fn the_sync_agent_may_only_ask_for_an_activation() {
        // The agent has no lifecycle role: Status and Retire from it are
        // refused with the frozen typed refusal, and Retire in particular
        // must not take effect.
        let slot = ActivationSlot::new();
        for line in [status_line(), retire_line()] {
            assert!(matches!(
                reply_of(decide(&slot, ClientKind::SyncAgent, &line)),
                HelperReply::CallerNotPermitted
            ));
        }
        assert_eq!(state_of(&slot), HelperStateName::Idle);

        // Its own request is served like the GUI's.
        let admission = decide(
            &slot,
            ClientKind::SyncAgent,
            &try_activate_line(HELPER_BUILD, "req-1"),
        );
        assert!(matches!(&admission, RequestAction::RunActivation { .. }));
        drop(admission);
    }

    #[test]
    fn an_unpermitted_caller_and_another_build_get_their_own_refusals() {
        // The two checks cannot collide, so their order is unobservable and
        // deliberately untested: `Status`/`Retire` carry no build ID, and
        // `TryActivate` is permitted for both client kinds. What is pinned is
        // that each condition produces its own typed refusal.
        let slot = ActivationSlot::new();
        assert!(matches!(
            reply_of(decide(&slot, ClientKind::SyncAgent, &retire_line())),
            HelperReply::CallerNotPermitted
        ));

        for kind in [ClientKind::Gui, ClientKind::SyncAgent] {
            match reply_of(decide(
                &slot,
                kind,
                &try_activate_line(OTHER_BUILD, "req-1"),
            )) {
                HelperReply::BuildMismatch { helper_build_id } => {
                    assert_eq!(helper_build_id, HELPER_BUILD);
                }
                other => panic!("unexpected reply: {other:?}"),
            }
        }
        assert_eq!(state_of(&slot), HelperStateName::Idle);
    }

    #[test]
    fn an_empty_peer_build_id_is_a_build_mismatch_not_a_parse_failure() {
        // An empty ID is readable and simply unequal to this helper's, so the
        // caller learns it must upgrade rather than that it was not understood.
        let slot = ActivationSlot::new();
        assert!(matches!(
            reply_of(decide(
                &slot,
                ClientKind::Gui,
                &try_activate_line("", "req-1")
            )),
            HelperReply::BuildMismatch { .. }
        ));
        assert_eq!(state_of(&slot), HelperStateName::Idle);
    }

    #[test]
    fn control_requests_are_answered_whatever_the_peers_build() {
        // Status and Retire carry no build ID at all, and unknown fields on
        // them are ignored: a GUI of any build discovers and retires this
        // helper. Their replies parse normally in the client.
        let slot = ActivationSlot::new();
        let reply = reply_of(decide(
            &slot,
            ClientKind::Gui,
            r#"{"kind":"status","fieldFromAnotherBuild":1}"#,
        ));
        assert!(matches!(reply, HelperReply::Status { .. }));
        assert_eq!(
            HelperReply::parse(&reply.encode()).expect("reply parses"),
            reply
        );

        let reply = reply_of(decide(
            &slot,
            ClientKind::Gui,
            r#"{"kind":"retire","fieldFromAnotherBuild":1}"#,
        ));
        assert!(matches!(reply, HelperReply::Retired { activation: None }));
        assert_eq!(
            HelperReply::parse(&reply.encode()).expect("reply parses"),
            reply
        );
        assert_eq!(state_of(&slot), HelperStateName::Retired);
    }

    // ------------------------------------------------------------------
    // Slot concurrency and transition ordering.
    // ------------------------------------------------------------------

    #[test]
    fn exactly_one_activation_admitted_under_concurrent_try_activate() {
        // Admission and the transition into Activating are one atomic step,
        // serialized across all connections: with the slot never finishing,
        // exactly one of the concurrent requests — from either client kind —
        // may be admitted; every other gets Busy(X).
        let slot = Arc::new(ActivationSlot::new());
        let decisions_made = Arc::new(Barrier::new(9));
        let observations_done = Arc::new(Barrier::new(9));
        let mut handles = Vec::new();
        for index in 0..8 {
            let slot = Arc::clone(&slot);
            let decisions_made = Arc::clone(&decisions_made);
            let observations_done = Arc::clone(&observations_done);
            let kind = if index % 2 == 0 {
                ClientKind::Gui
            } else {
                ClientKind::SyncAgent
            };
            handles.push(std::thread::spawn(move || {
                let action = decide_request(
                    &slot,
                    kind,
                    HELPER_BUILD,
                    &try_activate_line(HELPER_BUILD, &format!("req-{index}")),
                );
                let admitted = match &action {
                    RequestAction::RunActivation { .. } => true,
                    RequestAction::Reply(HelperReply::Busy { .. }) => false,
                    RequestAction::Reply(other) => panic!("unexpected reply: {other:?}"),
                };
                // Keep the admitted permit alive until every thread has made
                // its decision and the main thread has observed the slot.
                decisions_made.wait();
                observations_done.wait();
                admitted
            }));
        }
        decisions_made.wait();
        assert_eq!(state_of(&slot), HelperStateName::Activating);
        observations_done.wait();
        let admitted = handles
            .into_iter()
            .map(|handle| handle.join().expect("thread"))
            .filter(|admitted| *admitted)
            .count();

        assert_eq!(admitted, 1);
        assert_eq!(state_of(&slot), HelperStateName::Idle);
    }

    #[test]
    fn status_and_retire_are_not_blocked_by_the_activation() {
        // The slot is Activating (the admitted activation has not finished):
        // Status and Retire decisions remain prompt because the transition
        // mutex is never held across an activation.
        let slot = activating_slot();

        assert!(matches!(
            reply_of(decide(&slot, ClientKind::Gui, &status_line())),
            HelperReply::Status { .. }
        ));
        assert!(matches!(
            reply_of(decide(&slot, ClientKind::Gui, &retire_line())),
            HelperReply::Busy { .. }
        ));
    }

    #[test]
    fn activation_end_transition_precedes_the_result_reply() {
        // Single-threaded, so the ordering is observed rather than raced for:
        // producing the result reply consumes the permit, and by the time that
        // reply value exists the slot is already free for the next request.
        let slot = ActivationSlot::new();
        let permit = slot
            .admit(&body("req-1"), ClientKind::Gui)
            .expect("first activation admitted");
        assert_eq!(state_of(&slot), HelperStateName::Activating);

        let reply = permit.into_result_reply(ActivationResult {
            ok: true,
            code: 0,
            stdout: "activated".to_string(),
            error: None,
        });

        assert!(matches!(reply, HelperReply::ActivationResult(_)));
        assert_eq!(state_of(&slot), HelperStateName::Idle);
        let second = slot
            .admit(&body("req-2"), ClientKind::Gui)
            .expect("second activation admitted");
        drop(second);
    }

    #[test]
    fn latched_activation_end_retires() {
        let slot = ActivationSlot::new();
        let permit = slot
            .admit(&body("req-1"), ClientKind::Gui)
            .expect("activation admitted");
        assert!(matches!(slot.retire(), HelperReply::Busy { .. }));
        drop(permit);
        assert_eq!(state_of(&slot), HelperStateName::Retired);
    }

    #[test]
    fn retired_reply_to_retire_is_sent_only_from_the_retired_state() {
        // The transition takes effect before the reply: whenever Retire is
        // answered Retired, the slot is already Retired, so no concurrent
        // request can be admitted after it.
        let slot = ActivationSlot::new();
        let reply = reply_of(decide(&slot, ClientKind::Gui, &retire_line()));
        assert!(matches!(reply, HelperReply::Retired { .. }));
        assert_eq!(state_of(&slot), HelperStateName::Retired);
        assert!(matches!(
            reply_of(decide(
                &slot,
                ClientKind::Gui,
                &try_activate_line(HELPER_BUILD, "req-9")
            )),
            HelperReply::Retired { activation: None }
        ));
    }

    // ------------------------------------------------------------------
    // Connection semantics.
    // ------------------------------------------------------------------

    #[cfg(target_os = "macos")]
    fn test_config(kind: ClientKind) -> Arc<ServeConfig> {
        Arc::new(ServeConfig {
            slot: ActivationSlot::new(),
            helper_build_id: HELPER_BUILD.to_string(),
            authenticate: Box::new(move |stream| {
                let identity = peer_auth::peer_identity(stream).ok()?;
                Some(AuthedClient { identity, kind })
            }),
            run_activation: Box::new(|_, _| ActivationResult {
                ok: true,
                code: 0,
                stdout: "activated".to_string(),
                error: None,
            }),
        })
    }

    #[cfg(target_os = "macos")]
    fn refusing_config() -> Arc<ServeConfig> {
        Arc::new(ServeConfig {
            slot: ActivationSlot::new(),
            helper_build_id: HELPER_BUILD.to_string(),
            authenticate: Box::new(|_| None),
            run_activation: Box::new(|_, _| unreachable!("no activation from a refused peer")),
        })
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
            slot: ActivationSlot::new(),
            helper_build_id: HELPER_BUILD.to_string(),
            authenticate: Box::new(|stream| {
                let identity = peer_auth::peer_identity(stream).ok()?;
                Some(AuthedClient {
                    identity,
                    kind: ClientKind::Gui,
                })
            }),
            run_activation: Box::new(move |_, _| {
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

    /// Sends one request line on a fresh connection and returns the reply
    /// plus the still-open connection.
    #[cfg(target_os = "macos")]
    fn request_on_new_connection(socket_path: &Path, line: &str) -> (HelperReply, UnixStream) {
        let client = UnixStream::connect(socket_path).expect("connect");
        client
            .set_read_timeout(Some(std::time::Duration::from_secs(10)))
            .expect("set timeout");
        (&client)
            .write_all(format!("{line}\n").as_bytes())
            .expect("write request");
        let mut reply = String::new();
        {
            let mut reader = BufReader::new(client.try_clone().expect("clone"));
            reader.read_line(&mut reply).expect("read reply");
        }
        (HelperReply::parse(&reply).expect("reply parses"), client)
    }

    /// Sends a raw request through the authenticated connection handler, then
    /// parses the newline-framed bytes exactly as a client does. Unlike the
    /// decision-table tests, this covers framing, request reading, the helper's
    /// socket write, and reply parsing together.
    #[cfg(target_os = "macos")]
    fn raw_request_through_wire(line: &str) -> HelperReply {
        let (client, server) = UnixStream::pair().expect("socketpair");
        let config = test_config(ClientKind::Gui);
        let handler = std::thread::spawn(move || serve_connection(server, &config));

        (&client)
            .write_all(format!("{line}\n").as_bytes())
            .expect("write request");
        let mut reply = String::new();
        {
            let mut reader = BufReader::new(client.try_clone().expect("clone"));
            reader.read_line(&mut reply).expect("read reply");
        }
        let reply = HelperReply::parse(&reply).expect("client parses reply");

        // The authenticated handler deliberately stays open after its reply;
        // close the peer so the test can join it.
        drop(client);
        handler.join().expect("handler").expect("serves");
        reply
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn cross_build_control_requests_are_answered_through_the_real_wire_path() {
        // A GUI from another build asks with fields this build never heard of;
        // the answers must still come back on the wire.
        assert!(matches!(
            raw_request_through_wire(r#"{"kind":"status","fieldFromAnotherBuild":9999}"#),
            HelperReply::Status {
                state: HelperStateName::Idle,
                ..
            }
        ));
        assert!(matches!(
            raw_request_through_wire(r#"{"kind":"retire","fieldFromAnotherBuild":9999}"#),
            HelperReply::Retired { activation: None }
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

    #[cfg(target_os = "macos")]
    #[test]
    fn status_and_retire_are_answered_while_an_activation_actually_runs() {
        let (socket_path, config, gate, _dir) = blocking_activation_daemon();

        // Dispatch an activation that will not finish until released, on its
        // own connection, and wait until the slot really is occupied.
        let activation = std::thread::spawn({
            let socket_path = socket_path.clone();
            move || {
                request_on_new_connection(&socket_path, &try_activate_line(HELPER_BUILD, "req-1"))
            }
        });
        while state_of(&config.slot) != HelperStateName::Activating {
            std::thread::yield_now();
        }

        // Status is answered promptly and carries X.
        let (status, _status_connection) = request_on_new_connection(&socket_path, &status_line());
        match status {
            HelperReply::Status {
                state: HelperStateName::Activating,
                activation: Some(info),
                ..
            } => assert_eq!(info.request_id, "req-1"),
            other => panic!("unexpected reply: {other:?}"),
        }

        // Retire is answered promptly too: Busy(X), retirement latched.
        let (retire, _retire_connection) = request_on_new_connection(&socket_path, &retire_line());
        match retire {
            HelperReply::Busy { activation } => assert_eq!(activation.request_id, "req-1"),
            other => panic!("unexpected reply: {other:?}"),
        }
        assert_eq!(state_of(&config.slot), HelperStateName::Retiring);

        // Releasing the activation delivers its result, and the latched
        // retirement takes effect before that result reply is sent.
        {
            let (released, signal) = &*gate;
            *released.lock().expect("gate") = true;
            signal.notify_all();
        }
        let (result, _activation_connection) = activation.join().expect("activation");
        assert!(matches!(
            result,
            HelperReply::ActivationResult(ActivationResult { ok: true, .. })
        ));
        assert_eq!(state_of(&config.slot), HelperStateName::Retired);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn reply_leaves_the_connection_open_and_ignores_further_bytes() {
        let (client, server) = UnixStream::pair().expect("socketpair");
        let config = test_config(ClientKind::Gui);
        let handler = {
            let config = Arc::clone(&config);
            std::thread::spawn(move || serve_connection(server, &config))
        };

        (&client)
            .write_all(format!("{}\n", status_line()).as_bytes())
            .expect("write request");
        let mut reply = String::new();
        {
            // Scoped so this duplicate descriptor is closed before the drop
            // below: it is what actually has to close for the handler to see
            // the peer go away.
            let mut reader = BufReader::new(client.try_clone().expect("clone"));
            reader.read_line(&mut reply).expect("read reply");
        }
        assert!(matches!(
            HelperReply::parse(&reply).expect("reply parses"),
            HelperReply::Status { .. }
        ));

        // Further bytes are ignored and the helper does not close: a timed
        // read observes silence (WouldBlock), never EOF.
        (&client)
            .write_all(b"garbage after reply\n")
            .expect("write");
        client
            .set_read_timeout(Some(std::time::Duration::from_millis(200)))
            .expect("set timeout");
        let mut probe = [0u8; 8];
        match (&client).read(&mut probe) {
            Ok(0) => panic!("helper closed an authenticated connection"),
            Ok(_) => panic!("helper wrote bytes after its one reply"),
            Err(error) => assert!(matches!(
                error.kind(),
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
            )),
        }

        // The peer closing its end releases the handler.
        drop(client);
        handler.join().expect("handler").expect("serves");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn invalid_utf8_gets_request_not_understood_and_the_connection_stays_open() {
        let (client, server) = UnixStream::pair().expect("socketpair");
        let config = test_config(ClientKind::Gui);
        let handler = {
            let config = Arc::clone(&config);
            std::thread::spawn(move || serve_connection(server, &config))
        };

        (&client).write_all(b"\xff\n").expect("write invalid UTF-8");
        let mut reply = String::new();
        {
            let mut reader = BufReader::new(client.try_clone().expect("clone"));
            reader.read_line(&mut reply).expect("read refusal");
        }
        assert_eq!(
            reply,
            format!("{}\n", HelperReply::RequestNotUnderstood.encode())
        );

        client
            .set_read_timeout(Some(std::time::Duration::from_millis(200)))
            .expect("set timeout");
        let mut probe = [0u8; 1];
        match (&client).read(&mut probe) {
            Ok(0) => panic!("helper closed an authenticated connection"),
            Ok(_) => panic!("helper wrote bytes after its one refusal"),
            Err(error) => assert!(matches!(
                error.kind(),
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
            )),
        }

        drop(client);
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
    fn the_activation_slot_is_released_even_when_the_activation_unwinds() {
        // A slot stranded in Activating would make the helper report an
        // activation that is not running and refuse every later TryActivate
        // with Busy(X) for the rest of its process lifetime — and a GUI's
        // retire loop waits on Busy(X) unbounded by design, so nothing
        // recovers.
        let slot = ActivationSlot::new();
        let permit = slot
            .admit(&body("req-1"), ClientKind::Gui)
            .expect("activation admitted");
        let unwound = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let _permit = permit;
            panic!("activation exploded");
        }));

        assert!(unwound.is_err(), "the activation was supposed to panic");
        assert_eq!(state_of(&slot), HelperStateName::Idle);

        // Latched retirement still wins over the unwind: the helper must not
        // come back activatable after a Retire it already acknowledged.
        let latched = ActivationSlot::new();
        let permit = latched
            .admit(&body("req-2"), ClientKind::Gui)
            .expect("activation admitted");
        assert!(matches!(latched.retire(), HelperReply::Busy { .. }));
        let unwound = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            let _permit = permit;
            panic!("activation exploded");
        }));

        assert!(unwound.is_err(), "the activation was supposed to panic");
        assert_eq!(state_of(&latched), HelperStateName::Retired);
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
        let config = refusing_config();
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
        let config = test_config(ClientKind::Gui);
        let handler = std::thread::spawn(move || serve_connection(server, &config));

        // The first MAX_REQUEST_BYTES bytes are a valid Status envelope plus
        // JSON whitespace. Accepting that prefix before reading the suffix
        // would dispatch an oversized, incomplete frame.
        let mut oversized = status_line().into_bytes();
        oversized.resize(MAX_REQUEST_BYTES as usize, b' ');
        oversized.extend_from_slice(b"x\n");
        (&client).write_all(&oversized).expect("write");

        let mut reply = String::new();
        BufReader::new(client.try_clone().expect("clone"))
            .read_line(&mut reply)
            .expect("read reply");
        assert!(matches!(
            HelperReply::parse(&reply).expect("reply parses"),
            HelperReply::RequestNotUnderstood
        ));
        drop(client);
        handler.join().expect("handler").expect("serves");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn connections_past_the_cap_are_closed_without_protocol_bytes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let socket_path = dir.path().join("helper-test.sock");
        let listener = UnixListener::bind(&socket_path).expect("bind");
        let config = test_config(ClientKind::Gui);
        std::thread::spawn(move || serve(listener, config));

        // Fill every slot: each connection completes a request/reply and is
        // then deliberately held open (the helper never closes it, so the
        // slot stays occupied until this test drops the client end).
        let mut held = Vec::new();
        for _ in 0..MAX_CONCURRENT_CONNECTIONS {
            let client = UnixStream::connect(&socket_path).expect("connect");
            (&client)
                .write_all(format!("{}\n", status_line()).as_bytes())
                .expect("write request");
            let mut reply = String::new();
            BufReader::new(client.try_clone().expect("clone"))
                .read_line(&mut reply)
                .expect("read reply");
            assert!(HelperReply::parse(&reply).is_ok());
            held.push(client);
        }

        // The (cap+1)th connection is accepted and closed before any bytes.
        let extra = UnixStream::connect(&socket_path).expect("connect");
        extra
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .expect("set timeout");
        let mut probe = [0u8; 8];
        assert_eq!((&extra).read(&mut probe).expect("read"), 0);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn activation_result_reply_arrives_after_the_slot_transition() {
        // End-to-end over a socketpair: the admitted activation completes,
        // and by the time its result reply is readable, a second TryActivate
        // is admissible (transition-before-reply).
        let (client, server) = UnixStream::pair().expect("socketpair");
        let config = test_config(ClientKind::Gui);
        let handler = {
            let config = Arc::clone(&config);
            std::thread::spawn(move || serve_connection(server, &config))
        };

        (&client)
            .write_all(format!("{}\n", try_activate_line(HELPER_BUILD, "req-1")).as_bytes())
            .expect("write request");
        let mut reply = String::new();
        BufReader::new(client.try_clone().expect("clone"))
            .read_line(&mut reply)
            .expect("read reply");
        match HelperReply::parse(&reply).expect("reply parses") {
            HelperReply::ActivationResult(result) => assert!(result.ok),
            other => panic!("unexpected reply: {other:?}"),
        }

        // A smoke check that the whole path holds together, not the proof of
        // the ordering: this thread reaches its assertion after a wake-up and
        // three serde round-trips, so a handler that transitioned late would
        // still normally get there first. The ordering itself rests on
        // `into_result_reply` being the helper's only construction site for
        // this reply — pinned single-threaded by
        // `activation_end_transition_precedes_the_result_reply` — and on the
        // permit being scoped to `serve_connection`'s activation arm.
        let admission = decide(
            &config.slot,
            ClientKind::Gui,
            &try_activate_line(HELPER_BUILD, "req-2"),
        );
        assert!(
            matches!(&admission, RequestAction::RunActivation { .. }),
            "the slot was still occupied when its result reply arrived"
        );
        drop(admission);

        drop(client);
        handler.join().expect("handler").expect("serves");
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
