use crate::privileged_helper::client::{self, HelperClientError};
#[cfg(target_os = "macos")]
use crate::privileged_helper::protocol::{HELPER_LABEL, HELPER_PLIST_NAME};
use crate::privileged_helper::protocol::{HelperReply, HelperServiceStatus};
use anyhow::Result;
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::{Duration, Instant};

/// The four statuses `SMAppService` defines, and no others.
///
/// A raw value outside this set is an adapter error, never a fifth status:
/// every reconciliation decision is a total match over these four, and a
/// catch-all would let an unreadable registration pass for one of them.
// Only the macOS adapter reads a raw status, so off Apple nothing constructs
// one; mute dead-code there while keeping macOS builds strict.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegistrationStatus {
    /// Never registered, or unregistered after having been registered.
    NotRegistered,
    /// Registered and eligible to run.
    Enabled,
    /// Registered, but waiting on the user in System Settings — including a
    /// consent the user revoked there. An approval-pending service has no
    /// process.
    RequiresApproval,
    /// The bundle's service definition could not be found.
    NotFound,
}

impl RegistrationStatus {
    /// Maps one raw `SMAppServiceStatus`. `Err` carries the unrecognized value
    /// so the caller can report it verbatim.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    fn from_raw(raw: i64) -> Result<Self, i64> {
        match raw {
            0 => Ok(Self::NotRegistered),
            1 => Ok(Self::Enabled),
            2 => Ok(Self::RequiresApproval),
            3 => Ok(Self::NotFound),
            unknown => Err(unknown),
        }
    }
}

impl std::fmt::Display for RegistrationStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The Apple names, which the permissions UI already surfaces as detail.
        f.write_str(match self {
            RegistrationStatus::NotRegistered => "notRegistered",
            RegistrationStatus::Enabled => "enabled",
            RegistrationStatus::RequiresApproval => "requiresApproval",
            RegistrationStatus::NotFound => "notFound",
        })
    }
}

/// A failed ServiceManagement call, preserved structurally.
///
/// The `NSError` domain and code are the identity of the failure; the localized
/// description is diagnostic text for reports and logs and nothing else. No
/// decision may be derived from it — it is localized, and Apple may reword it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceCallError {
    pub domain: String,
    pub code: i64,
    pub localized: String,
}

impl std::fmt::Display for ServiceCallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}: {}", self.domain, self.code, self.localized)
    }
}

/// What one asynchronous ServiceManagement call reported.
pub type ServiceCallOutcome = Result<(), ServiceCallError>;

/// Why a helper replacement stopped short.
///
/// Total, like [`RegistrationStatus`]: every way out of [`replace_helper`] is
/// one of these, so a caller decides by matching and never by a catch-all. Each
/// variant also states what is registered afterwards, because that is what the
/// caller has to report and what its next observation has to agree with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReplaceFailure<E> {
    /// Refused before anything was dispatched, so nothing changed. The main
    /// thread is the one that has to issue both calls; awaiting them there
    /// would starve the queue that makes them.
    CalledOnMainThread,
    /// The platform refused the unregister. The old helper is still registered.
    UnregisterFailed(ServiceCallError),
    /// The unregister never reported inside the window. The old process may
    /// still be alive, so no replacement was registered.
    UnregisterSilent,
    /// The old process is gone and the caller declined the replacement, so no
    /// helper is registered now. The reason is the caller's own: this module
    /// supplies the point where such a decision is possible and takes none.
    RegisterDeclined(E),
    /// The old process is gone and the replacement was refused: no helper is
    /// registered now.
    RegisterFailed(ServiceCallError),
    /// The old process is gone and the replacement never reported. Whether it
    /// took is unknown — only a fresh observation can say.
    RegisterSilent,
}

impl<E: std::fmt::Display> std::fmt::Display for ReplaceFailure<E> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CalledOnMainThread => {
                f.write_str("a helper replacement cannot be awaited on the main thread")
            }
            Self::UnregisterFailed(error) => write!(f, "unregister failed: {error}"),
            Self::UnregisterSilent => f.write_str("unregister never reported"),
            Self::RegisterDeclined(reason) => write!(f, "the replacement was declined: {reason}"),
            Self::RegisterFailed(error) => write!(f, "register failed: {error}"),
            Self::RegisterSilent => f.write_str("register never reported"),
        }
    }
}

/// Why a standalone register stopped short. [`ReplaceFailure`]'s register
/// variants say the same things about a register that followed a kill.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegisterFailure {
    /// Refused before anything was dispatched: the main thread is the one that
    /// has to make the call, so awaiting it there would starve the queue.
    CalledOnMainThread,
    /// The platform refused the registration; nothing is registered.
    Failed(ServiceCallError),
    /// The call never reported inside the window. Whether it took is unknown —
    /// only a fresh observation can say.
    Silent,
}

impl std::fmt::Display for RegisterFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CalledOnMainThread => {
                f.write_str("a registration cannot be awaited on the main thread")
            }
            Self::Failed(error) => write!(f, "register failed: {error}"),
            Self::Silent => f.write_str("register never reported"),
        }
    }
}

/// How work reaches a later main-queue run-loop turn. Injectable so a test can
/// run the work somewhere other than a main queue it has no run loop to drain.
type LaterMainQueueTurn<'a> = &'a dyn Fn(Box<dyn FnOnce() + Send + 'static>);

pub fn status() -> HelperServiceStatus {
    let mut status = platform_status();
    status.socket_available = client::socket_available();
    // SMAppService state and a socket path prove nothing about the daemon:
    // only an authenticated round-trip (mutual code-signature validation)
    // shows the connection actually works.
    if status.socket_available {
        fold_status_probe(&mut status, client::status().map(|exchange| exchange.reply));
    }
    status
}

/// Folds one status round-trip into the service status. Only an
/// authenticated `Status` reply naming a state marks the daemon responding;
/// a typed refusal, an unparseable reply, or any exchange failure can only
/// ever reach `detail`.
fn fold_status_probe(
    status: &mut HelperServiceStatus,
    probe: Result<HelperReply, HelperClientError>,
) {
    match probe {
        Ok(HelperReply::Status { .. }) => status.responding = true,
        Ok(reply) => status.detail = Some(reply.summary()),
        Err(error) => status.detail = Some(error.to_string()),
    }
}

/// The typed registration status of nixmac's helper service.
///
/// What the GUI's helper reconciliation decides from; the permissions UI reads
/// the folded [`status`] instead.
pub fn registration_status() -> Result<RegistrationStatus> {
    platform_registration_status()
}

pub fn register() -> Result<HelperServiceStatus> {
    platform_register()?;
    Ok(status())
}

pub fn unregister() -> Result<HelperServiceStatus> {
    platform_unregister()?;
    Ok(status())
}

/// Replaces the registered helper: unregisters, waits for the running process
/// to be killed, asks `commit_to_register`, then registers the replacement.
///
/// The asynchronous unregister exists for one reason: its completion fires
/// *after* the running helper process has been killed, which is the only signal
/// that makes re-registering safe. The synchronous [`unregister`] returns before
/// the process is reaped and cannot answer that question. Registering only after
/// that completion has arrived is also the Apple DTS workaround for an immediate
/// re-registration failing (<https://developer.apple.com/forums/thread/783539>):
/// the second dispatch is unavoidably a later main-queue turn than the first,
/// because this function does not reach it until the first has reported.
///
/// `commit_to_register` runs at the one moment between the two calls where the
/// old process is confirmed gone and nothing is registered yet — the only place
/// a caller can re-check a decision that a replacement would otherwise
/// invalidate. It runs on the *calling* thread, not on the main queue, and an
/// `Err` leaves no helper registered and is reported verbatim as
/// [`ReplaceFailure::RegisterDeclined`]. Nothing here inspects that reason:
/// which conditions may decline a replacement is the caller's policy, and this
/// module holds none.
///
/// Blocks for at most `within` across both calls. Both are issued *on* the main
/// queue, so a main-thread caller would starve the queue that has to make them
/// and see a callback that never arrives; that is refused up front rather than
/// left to a misread timeout. A GUI calls this off the main thread.
pub fn replace_helper<E>(
    within: Duration,
    commit_to_register: impl FnOnce() -> Result<(), E>,
) -> Result<(), ReplaceFailure<E>> {
    replace_helper_via(
        &on_later_main_queue_turn,
        on_main_thread(),
        within,
        commit_to_register,
    )
}

fn replace_helper_via<E>(
    dispatch: LaterMainQueueTurn<'_>,
    on_main_thread: bool,
    within: Duration,
    commit_to_register: impl FnOnce() -> Result<(), E>,
) -> Result<(), ReplaceFailure<E>> {
    if on_main_thread {
        return Err(ReplaceFailure::CalledOnMainThread);
    }
    let deadline = Instant::now() + within;

    // Nothing but the sink crosses the queue boundary: the work reads the
    // compiled plist name and builds the service and its completion block on the
    // main queue itself. That no retained object can travel is enforced rather
    // than trusted — `Retained` is not `Send` and the dispatch demands `Send`.
    let killed = dispatched_call(dispatch, platform_unregister_awaiting_kill);
    fold_replacement(awaited(killed, deadline), commit_to_register, || {
        // Reached only once the unregister has reported, which is what makes
        // this dispatch a later main-queue turn than that one.
        dispatched_register(dispatch, deadline)
    })
}

/// Decides a replacement from what the two calls reported, `None` meaning
/// nothing reported inside the window.
///
/// `commit_to_register` and `register` are reached only when the unregister
/// confirmed the kill: every other path leaves a process that may still be
/// running, and registering on top of one is the thing this whole sequence
/// exists to avoid. A caller that declines stops there too — with the old
/// process already gone, since the decision is only possible after the kill it
/// is being asked about.
fn fold_replacement<E>(
    killed: Option<ServiceCallOutcome>,
    commit_to_register: impl FnOnce() -> Result<(), E>,
    register: impl FnOnce() -> Option<ServiceCallOutcome>,
) -> Result<(), ReplaceFailure<E>> {
    match killed {
        Some(Ok(())) => {}
        Some(Err(error)) => return Err(ReplaceFailure::UnregisterFailed(error)),
        None => return Err(ReplaceFailure::UnregisterSilent),
    }
    if let Err(reason) = commit_to_register() {
        return Err(ReplaceFailure::RegisterDeclined(reason));
    }
    match register() {
        Some(Ok(())) => Ok(()),
        Some(Err(error)) => Err(ReplaceFailure::RegisterFailed(error)),
        None => Err(ReplaceFailure::RegisterSilent),
    }
}

/// Registers the bundled helper on a later main-queue run-loop turn, with
/// nothing unregistered first.
///
/// This is the path from `notRegistered`, where there is no process to kill and
/// so nothing to wait for. Replacing a *running* helper goes through
/// [`replace_helper`], which calls the same dispatch as its second half — one
/// register implementation, so the later-turn dispatch and the window cannot
/// drift apart between the two paths.
///
/// Refused on the main thread for the same reason as [`replace_helper`]: the
/// call is issued *on* the main queue and awaited here.
pub fn register_on_later_turn(within: Duration) -> Result<(), RegisterFailure> {
    register_on_later_turn_via(&on_later_main_queue_turn, on_main_thread(), within)
}

fn register_on_later_turn_via(
    dispatch: LaterMainQueueTurn<'_>,
    on_main_thread: bool,
    within: Duration,
) -> Result<(), RegisterFailure> {
    if on_main_thread {
        return Err(RegisterFailure::CalledOnMainThread);
    }
    match dispatched_register(dispatch, Instant::now() + within) {
        Some(Ok(())) => Ok(()),
        Some(Err(error)) => Err(RegisterFailure::Failed(error)),
        None => Err(RegisterFailure::Silent),
    }
}

/// Dispatches the register to a later main-queue turn and waits out `deadline`
/// for it, like every other call here.
fn dispatched_register(
    dispatch: LaterMainQueueTurn<'_>,
    deadline: Instant,
) -> Option<ServiceCallOutcome> {
    let registered = dispatched_call(dispatch, |sink| {
        let _ = sink.send(platform_register_reporting_error());
    });
    awaited(registered, deadline)
}

/// Dispatches one ServiceManagement call to a later main-queue turn and hands
/// back the receiver its outcome arrives on.
///
/// Apple documents the completion handler as running once. Nothing here relies
/// on that. [`awaited`] reads one value and then drops the receiver, so if the
/// handler ran a second time its outcome would either sit unread in the channel
/// or find no receiver left to take it. The caller sees the first outcome and no
/// other.
fn dispatched_call(
    dispatch: LaterMainQueueTurn<'_>,
    call: impl FnOnce(Sender<ServiceCallOutcome>) + Send + 'static,
) -> Receiver<ServiceCallOutcome> {
    let (sink, outcome) = mpsc::channel();
    dispatch(Box::new(move || call(sink)));
    outcome
}

/// The outcome, or `None` once `deadline` has passed with nothing reported.
///
/// A dropped sender counts as nothing reported: work that was never run and a
/// callback that never fired are the same fact to the caller, and neither may
/// be waited out past the deadline it set.
fn awaited(outcome: Receiver<ServiceCallOutcome>, deadline: Instant) -> Option<ServiceCallOutcome> {
    outcome
        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        .ok()
}

#[cfg(target_os = "macos")]
fn on_main_thread() -> bool {
    objc2_foundation::NSThread::isMainThread_class()
}

#[cfg(not(target_os = "macos"))]
fn on_main_thread() -> bool {
    false
}

pub fn open_login_items_settings() {
    platform_open_login_items_settings();
}

#[cfg(target_os = "macos")]
fn on_later_main_queue_turn(work: Box<dyn FnOnce() + Send + 'static>) {
    dispatch2::DispatchQueue::main().exec_async(work);
}

/// No main queue to hop onto off Apple platforms; the work runs inline and its
/// only possible outcome there is the "macOS only" error.
#[cfg(not(target_os = "macos"))]
fn on_later_main_queue_turn(work: Box<dyn FnOnce() + Send + 'static>) {
    work();
}

#[cfg(target_os = "macos")]
fn platform_status() -> HelperServiceStatus {
    match macos::registration_status() {
        Ok(status) => HelperServiceStatus {
            label: HELPER_LABEL.to_string(),
            available: true,
            registered: status != RegistrationStatus::NotRegistered,
            authorized: status == RegistrationStatus::Enabled,
            socket_available: false,
            responding: false,
            detail: Some(status.to_string()),
        },
        Err(error) => HelperServiceStatus::unavailable(error.to_string()),
    }
}

#[cfg(not(target_os = "macos"))]
fn platform_status() -> HelperServiceStatus {
    HelperServiceStatus::unavailable("SMAppService is only available on macOS")
}

#[cfg(target_os = "macos")]
fn platform_registration_status() -> Result<RegistrationStatus> {
    macos::registration_status()
}

#[cfg(not(target_os = "macos"))]
fn platform_registration_status() -> Result<RegistrationStatus> {
    anyhow::bail!("SMAppService is only available on macOS")
}

#[cfg(target_os = "macos")]
fn platform_register() -> Result<()> {
    macos::register_service()
}

#[cfg(not(target_os = "macos"))]
fn platform_register() -> Result<()> {
    anyhow::bail!("SMAppService is only available on macOS")
}

#[cfg(target_os = "macos")]
fn platform_register_reporting_error() -> ServiceCallOutcome {
    macos::register_service_reporting_error()
}

#[cfg(not(target_os = "macos"))]
fn platform_register_reporting_error() -> ServiceCallOutcome {
    Err(adapter_error("SMAppService is only available on macOS"))
}

#[cfg(target_os = "macos")]
fn platform_unregister() -> Result<()> {
    macos::unregister_service()
}

#[cfg(not(target_os = "macos"))]
fn platform_unregister() -> Result<()> {
    anyhow::bail!("SMAppService is only available on macOS")
}

#[cfg(target_os = "macos")]
fn platform_unregister_awaiting_kill(sink: Sender<ServiceCallOutcome>) {
    macos::unregister_service_awaiting_kill(sink);
}

#[cfg(not(target_os = "macos"))]
fn platform_unregister_awaiting_kill(sink: Sender<ServiceCallOutcome>) {
    let _ = sink.send(Err(adapter_error(
        "SMAppService is only available on macOS",
    )));
}

/// Domain reported when the adapter itself refused to make the call, so a
/// caller can tell "the platform said no" from "we never asked it".
const ADAPTER_ERROR_DOMAIN: &str = "com.darkmatter.nixmac.serviceAdapter";

fn adapter_error(detail: impl Into<String>) -> ServiceCallError {
    ServiceCallError {
        domain: ADAPTER_ERROR_DOMAIN.to_string(),
        code: 0,
        localized: detail.into(),
    }
}

#[cfg(target_os = "macos")]
fn platform_open_login_items_settings() {
    macos::open_login_items_settings();
}

#[cfg(not(target_os = "macos"))]
fn platform_open_login_items_settings() {}

#[cfg(target_os = "macos")]
mod macos {
    use super::{
        HELPER_PLIST_NAME, RegistrationStatus, ServiceCallError, ServiceCallOutcome, adapter_error,
    };
    use anyhow::{Result, anyhow, bail};
    use block2::RcBlock;
    use objc2::rc::{Retained, autoreleasepool};
    use objc2::runtime::AnyClass;
    use objc2_foundation::{NSError, NSString};
    use objc2_service_management::SMAppService;
    use std::sync::mpsc::Sender;

    pub fn registration_status() -> Result<RegistrationStatus> {
        autoreleasepool(|_| {
            let service = daemon_service()?;
            let raw = unsafe { service.status() }.0 as i64;
            RegistrationStatus::from_raw(raw)
                .map_err(|unknown| anyhow!("SMAppService reported an unknown status: {unknown}"))
        })
    }

    pub fn register_service() -> Result<()> {
        autoreleasepool(|_| {
            let service = daemon_service()?;
            unsafe { service.registerAndReturnError() }
                .map_err(|error| anyhow!(describe(&error, "SMAppService register failed")))
        })
    }

    /// [`register_service`] reporting the platform failure structurally. Runs
    /// wherever it is dispatched — the caller guarantees a later main-queue turn
    /// — and builds its own service from the compiled plist name, so no retained
    /// object is ever moved between threads.
    pub fn register_service_reporting_error() -> ServiceCallOutcome {
        autoreleasepool(|_| {
            let service = daemon_service().map_err(|error| adapter_error(error.to_string()))?;
            unsafe { service.registerAndReturnError() }.map_err(|error| structured(&error))
        })
    }

    pub fn unregister_service() -> Result<()> {
        autoreleasepool(|_| {
            let service = daemon_service()?;
            unsafe { service.unregisterAndReturnError() }
                .map_err(|error| anyhow!(describe(&error, "SMAppService unregister failed")))
        })
    }

    /// Asynchronous unregister. Per the SDK header — the public documentation
    /// page does not state this — the completion handler is invoked after the
    /// running process has been killed on success, or whenever an error occurs,
    /// and re-registering is safe once it has been invoked. The header also says
    /// it is invoked on libdispatch's default target queue, which is why nothing
    /// Objective-C is dropped inside it.
    pub fn unregister_service_awaiting_kill(sink: Sender<ServiceCallOutcome>) {
        autoreleasepool(|_| {
            let service = match daemon_service() {
                Ok(service) => service,
                Err(error) => {
                    let _ = sink.send(Err(adapter_error(error.to_string())));
                    return;
                }
            };

            // The handler captures nothing but the sink. It reads the error
            // through a borrow, so the NSError's retain count is untouched, and
            // the only Objective-C objects it drops are the two strings
            // `structured` copies out of it — Foundation value objects, safe to
            // release on whatever queue libdispatch invokes this on. Nothing
            // this turn created is released there.
            //
            // The send is unchecked because both ways it can fail are the
            // caller's business and not this queue's: the caller's window
            // expired and it dropped the receiver, or the API called back twice
            // and only the first value is read.
            let block = RcBlock::new(move |error: *mut NSError| {
                let outcome = match unsafe { error.as_ref() } {
                    None => Ok(()),
                    Some(error) => Err(structured(error)),
                };
                let _ = sink.send(outcome);
            });
            unsafe { service.unregisterWithCompletionHandler(&block) };

            // Deliberately kept alive past the callback, which fires long after
            // this call returns. By convention this is not required — the
            // handler is taken by borrow, which is exactly the block-ABI
            // signal that a callee storing it must copy it, and a framework
            // continuation retains whatever it captures — but the convention is
            // all there is: nothing in the binding or the SDK header states
            // either retain, and the callback is the step the whole replacement
            // hangs on. Dropping them here would be sound thread-wise (this is
            // the main queue, where they were created); leaking them costs two
            // small objects per unregister, and a GUI unregisters at most a
            // handful of times per run.
            std::mem::forget(block);
            std::mem::forget(service);
        });
    }

    pub fn open_login_items_settings() {
        if !service_management_available() {
            fallback_open_login_items_settings();
            return;
        }
        autoreleasepool(|_| unsafe { SMAppService::openSystemSettingsLoginItems() });
    }

    /// `SMAppService` exists from macOS 13 on; the bundle still launches on
    /// older systems, where every call here has to fail rather than trap on a
    /// missing class.
    fn service_management_available() -> bool {
        AnyClass::get(c"SMAppService").is_some()
    }

    /// The daemon service for nixmac's helper plist. The missing-class check is
    /// the only failure this can report: the generated binding declares the
    /// result non-optional, following Apple's nonnull annotation, so objc2
    /// panics on a nil rather than returning it — and on the dispatched paths
    /// that panic crosses libdispatch's `extern "C"` boundary and aborts. Apple
    /// annotating the return nonnull is the whole reason this is acceptable; the
    /// hand-rolled predecessor reported nil as an error instead.
    fn daemon_service() -> Result<Retained<SMAppService>> {
        if !service_management_available() {
            bail!("SMAppService is unavailable on this macOS version");
        }
        let plist_name = NSString::from_str(HELPER_PLIST_NAME);
        Ok(unsafe { SMAppService::daemonServiceWithPlistName(&plist_name) })
    }

    /// Splits an `NSError` into the parts decisions may use (domain, code) and
    /// the part only reports may use (the localized description).
    pub fn structured(error: &NSError) -> ServiceCallError {
        ServiceCallError {
            domain: error.domain().to_string(),
            code: error.code() as i64,
            localized: error.localizedDescription().to_string(),
        }
    }

    fn describe(error: &NSError, fallback: &str) -> String {
        let structured = structured(error);
        if structured.localized.is_empty() {
            return format!("{fallback} ({} {})", structured.domain, structured.code);
        }
        structured.to_string()
    }

    fn fallback_open_login_items_settings() {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.LoginItems-Settings.extension")
            .spawn();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::privileged_helper::peer_auth::ClientKind;
    use crate::privileged_helper::protocol::{ActivationInfo, HELPER_LABEL, HelperStateName};
    use std::cell::Cell;

    fn probed_status() -> HelperServiceStatus {
        HelperServiceStatus {
            label: HELPER_LABEL.to_string(),
            available: true,
            registered: true,
            authorized: true,
            socket_available: true,
            responding: false,
            detail: None,
        }
    }

    fn status_reply(state: HelperStateName) -> HelperReply {
        let activation = matches!(
            state,
            HelperStateName::Activating | HelperStateName::Retiring
        )
        .then(|| ActivationInfo {
            request_id: "req-1".to_string(),
            script_path: "/nix/store/abc-darwin-system/activate".to_string(),
            client_kind: ClientKind::Gui,
        });
        HelperReply::Status {
            state,
            helper_build_id: "build-a".to_string(),
            activation,
        }
    }

    #[test]
    fn authenticated_status_reply_sets_responding_whatever_the_state() {
        // `responding` means the daemon answered an authenticated Status
        // round-trip naming a state — any of the four.
        for state in [
            HelperStateName::Idle,
            HelperStateName::Activating,
            HelperStateName::Retiring,
            HelperStateName::Retired,
        ] {
            let mut status = probed_status();

            fold_status_probe(&mut status, Ok(status_reply(state)));

            assert!(status.responding);
            assert_eq!(status.detail, None);
        }
    }

    #[test]
    fn typed_refusals_never_set_responding() {
        for reply in [
            HelperReply::BuildMismatch {
                helper_build_id: "build-b".to_string(),
            },
            HelperReply::CallerNotPermitted,
            HelperReply::RequestNotUnderstood,
        ] {
            let mut status = probed_status();

            fold_status_probe(&mut status, Ok(reply));

            assert!(!status.responding);
            assert!(status.detail.is_some());
        }
    }

    #[test]
    fn exchange_failures_never_set_responding() {
        // What reaches the fold when an installed daemon from a previous
        // release answers with a reply this build cannot parse, or the
        // exchange fails outright.
        for error in [
            HelperClientError::UnparseableReply("unknown reply shape".to_string()),
            HelperClientError::ClosedBeforeReply,
            HelperClientError::AuthenticationFailed(anyhow::anyhow!("not the signed helper")),
            HelperClientError::Io(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "read timed out",
            )),
        ] {
            let mut status = probed_status();

            fold_status_probe(&mut status, Err(error));

            assert!(!status.responding);
            assert!(status.detail.is_some());
        }
    }

    #[test]
    fn the_four_smappservice_statuses_map_by_raw_value() {
        // The raw values are Apple's enum order; a wrong mapping would send the
        // whole decision table down the wrong column.
        for (raw, expected, name) in [
            (0, RegistrationStatus::NotRegistered, "notRegistered"),
            (1, RegistrationStatus::Enabled, "enabled"),
            (2, RegistrationStatus::RequiresApproval, "requiresApproval"),
            (3, RegistrationStatus::NotFound, "notFound"),
        ] {
            assert_eq!(RegistrationStatus::from_raw(raw), Ok(expected));
            assert_eq!(expected.to_string(), name);
        }
    }

    #[test]
    fn an_unknown_raw_status_is_an_error_and_never_a_fifth_status() {
        // No catch-all: an unrecognized value is reported, so it can never be
        // mistaken for "not registered" (which would authorize a register) or
        // for "enabled" (which would authorize a removal).
        for unknown in [-1, 4, 99] {
            assert_eq!(RegistrationStatus::from_raw(unknown), Err(unknown));
        }
    }

    fn refusal(code: i64) -> ServiceCallError {
        ServiceCallError {
            domain: "SMAppServiceErrorDomain".to_string(),
            code,
            localized: "operation not permitted".to_string(),
        }
    }

    /// Counts dispatches and drops the work unrun. Dropping is deliberate on
    /// both counts: running it would unregister and register the real service,
    /// and a dropped sink is exactly the callback that never arrives.
    fn counting_dispatch(dispatched: &Cell<usize>) -> impl Fn(Box<dyn FnOnce() + Send + 'static>) {
        move |work| {
            dispatched.set(dispatched.get() + 1);
            drop(work);
        }
    }

    /// The gate every test below that is not about declining passes: it commits,
    /// and records that it was consulted at all.
    fn committing(consulted: &Cell<bool>) -> impl FnOnce() -> Result<(), &'static str> {
        move || {
            consulted.set(true);
            Ok(())
        }
    }

    #[test]
    fn a_replacement_on_the_main_thread_is_refused_before_anything_is_dispatched() {
        // The whole reason this is one blocking call. The main thread is what
        // has to issue both calls, so awaiting them there would starve the
        // queue and expire as "the callback never arrived" — a wrong diagnosis
        // of a deadlock. Refusing up front makes it a fact instead, and leaves
        // the registration exactly as it was.
        let dispatched = Cell::new(0);
        let consulted = Cell::new(false);

        let outcome = replace_helper_via(
            &counting_dispatch(&dispatched),
            true,
            Duration::from_secs(30),
            committing(&consulted),
        );

        assert_eq!(outcome, Err(ReplaceFailure::CalledOnMainThread));
        assert_eq!(dispatched.get(), 0);
        assert!(
            !consulted.get(),
            "asked to commit to a replacement it refused"
        );
    }

    #[test]
    fn a_silent_unregister_expires_and_never_dispatches_a_register() {
        // A completion that never fires leaves the old process possibly alive,
        // so the replacement must not be registered on top of it — and the
        // window is what stops a silent callback from holding the caller. The
        // gate is not consulted either: there is no point asking whether to
        // replace a process that may still be running.
        let dispatched = Cell::new(0);
        let consulted = Cell::new(false);

        let outcome = replace_helper_via(
            &counting_dispatch(&dispatched),
            false,
            Duration::from_secs(30),
            committing(&consulted),
        );

        assert_eq!(outcome, Err(ReplaceFailure::UnregisterSilent));
        assert_eq!(dispatched.get(), 1, "the register was never dispatched");
        assert!(!consulted.get());
    }

    #[test]
    fn a_register_on_the_main_thread_is_refused_before_anything_is_dispatched() {
        // Same starvation argument as the replacement: this call is issued on
        // the main queue and awaited here.
        let dispatched = Cell::new(0);

        let outcome = register_on_later_turn_via(
            &counting_dispatch(&dispatched),
            true,
            Duration::from_secs(30),
        );

        assert_eq!(outcome, Err(RegisterFailure::CalledOnMainThread));
        assert_eq!(dispatched.get(), 0);
    }

    #[test]
    fn a_register_that_never_reports_expires_as_silent() {
        // The dropped sink is the callback that never arrives; the window is
        // what keeps it from holding the caller.
        let dispatched = Cell::new(0);

        let outcome = register_on_later_turn_via(
            &counting_dispatch(&dispatched),
            false,
            Duration::from_secs(30),
        );

        assert_eq!(outcome, Err(RegisterFailure::Silent));
        assert_eq!(dispatched.get(), 1);
    }

    #[test]
    fn a_replacement_registers_only_after_the_kill_was_confirmed() {
        // The decision table, and the one rule inside it: every outcome but a
        // confirmed kill leaves a process that may still be running, and
        // neither the gate nor the register may be reached from any of them.
        for (killed, expected) in [
            (
                Some(Err(refusal(3))),
                Err(ReplaceFailure::UnregisterFailed(refusal(3))),
            ),
            (None, Err(ReplaceFailure::UnregisterSilent)),
        ] {
            let consulted = Cell::new(false);
            let registered = Cell::new(false);

            let outcome = fold_replacement(killed, committing(&consulted), || {
                registered.set(true);
                Some(Ok(()))
            });

            assert_eq!(outcome, expected);
            assert!(
                !consulted.get(),
                "asked to commit after an unconfirmed kill"
            );
            assert!(!registered.get(), "registered after an unconfirmed kill");
        }

        let consulted = Cell::new(false);
        assert_eq!(
            fold_replacement(Some(Ok(())), committing(&consulted), || Some(Ok(()))),
            Ok(())
        );
        assert!(consulted.get(), "registered without asking");
        assert_eq!(
            fold_replacement(Some(Ok(())), committing(&consulted), || Some(Err(refusal(
                4
            )))),
            Err(ReplaceFailure::RegisterFailed(refusal(4)))
        );
        assert_eq!(
            fold_replacement(Some(Ok(())), committing(&consulted), || None),
            Err(ReplaceFailure::RegisterSilent)
        );
    }

    #[test]
    fn a_declined_replacement_kills_the_old_helper_and_registers_nothing() {
        // The point of the gate: after the kill is confirmed, a caller whose
        // decision changed meanwhile stops the sequence here rather than
        // discovering afterwards that a helper it no longer wants is
        // registered. Its reason travels back untouched — this module reads
        // nothing into it.
        let registered = Cell::new(false);

        let outcome = fold_replacement(
            Some(Ok(())),
            || Err("the user disabled the helper while it was retiring"),
            || {
                registered.set(true);
                Some(Ok(()))
            },
        );

        assert_eq!(
            outcome,
            Err(ReplaceFailure::RegisterDeclined(
                "the user disabled the helper while it was retiring"
            ))
        );
        assert!(!registered.get(), "registered after being declined");
    }

    #[test]
    fn only_the_first_of_a_repeated_callback_is_reported() {
        // "The completion handler is invoked once" is a promise of the API and
        // not of the universe; a platform that called back twice cannot
        // overwrite what was already read.
        let (sink, outcome) = mpsc::channel::<ServiceCallOutcome>();
        sink.send(Err(refusal(3))).expect("first");
        sink.send(Ok(())).expect("second");

        assert_eq!(
            awaited(outcome, Instant::now() + Duration::from_secs(30)),
            Some(Err(refusal(3)))
        );
    }

    #[test]
    fn a_call_that_never_reports_expires_rather_than_being_waited_out_twice() {
        // Both ways a call goes quiet — work that never ran, a callback that
        // never fired — read as nothing reported, and a deadline already passed
        // costs the next wait nothing. That is what keeps one window bounding
        // the pair instead of each call getting a fresh one.
        let (sink, outcome) = mpsc::channel::<ServiceCallOutcome>();
        drop(sink);
        let (_held, silent) = mpsc::channel::<ServiceCallOutcome>();
        let deadline = Instant::now() + Duration::from_millis(50);

        let started = Instant::now();

        assert_eq!(awaited(outcome, deadline), None);
        assert_eq!(awaited(silent, deadline), None);
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn an_outcome_cuts_the_window_short_rather_than_waiting_it_out() {
        // A 30 s bound that is always paid would be 30 s of held reconciliation
        // on every replacement.
        let (sink, outcome) = mpsc::channel::<ServiceCallOutcome>();
        let handle = std::thread::spawn(move || sink.send(Ok(())));

        let started = Instant::now();

        assert_eq!(
            awaited(outcome, Instant::now() + Duration::from_secs(30)),
            Some(Ok(()))
        );
        assert!(started.elapsed() < Duration::from_secs(5));
        handle.join().expect("deliverer").expect("sent");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn an_ns_error_keeps_its_domain_and_code_whatever_its_text_says() {
        // Decisions read domain and code; the localized description is report
        // text. Both are carried, and the structured pair does not depend on
        // the wording.
        use objc2_foundation::NSString;

        let domain = NSString::from_str("SMAppServiceErrorDomain");
        let error =
            unsafe { objc2_foundation::NSError::errorWithDomain_code_userInfo(&domain, 3, None) };

        let structured = macos::structured(&error);

        assert_eq!(structured.domain, "SMAppServiceErrorDomain");
        assert_eq!(structured.code, 3);
        // Apple supplies the wording for an unknown code; whatever it is, the
        // decision-bearing fields above are unaffected by it.
        assert!(!structured.localized.is_empty());
        assert!(structured.to_string().contains("SMAppServiceErrorDomain 3"));
    }
}
