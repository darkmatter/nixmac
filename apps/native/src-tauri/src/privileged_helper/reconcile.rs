// Reconciling the installed privileged helper with the running build.
//
// One idempotent function. Every run observes the world, drives it one step
// closer to the stored decision, and forgets everything: no phase, no
// progress, no recovery mode. A run that dies anywhere is repaired by the
// next one, which starts over from fresh observation. That is the whole
// design — there is deliberately nothing here that coordinates, queues, or
// remembers.
//
// The shape of a run:
//
//   install gate → stale gate → resolve the stored decision → the
//   status × decision table → classify the peer → retire → unregister →
//   register → verify
//
// Three things carry the safety of it, and they are types rather than
// discipline:
//
//   * `ReplacementSlot` — minted only by try-acquire, released by `Drop` on
//     every path out of a run including a panic. One run at a time, and a
//     concurrent caller is told `Busy` rather than made to wait.
//   * `Authorized` — which of the three rules authorizes one unregister.
//     `remove` and `replace` take it, so nothing terminates a helper without
//     naming an authority, and `confirm` re-establishes the two revocable ones
//     immediately before the call.
//   * `Committed` — demanded by every register, and minted in exactly one
//     place: the register step's immediately-before checks. Nothing outside
//     this module can construct one, so a register reached from anywhere else
//     has nothing to pass.
//
// Nothing here can open System Settings: that capability is absent from the
// seam, which is how startup and refresh are kept from doing it.

use crate::build_id;
use crate::privileged_helper::client::{self, AssessedExchange, HelperClientError};
use crate::privileged_helper::protocol::{self, ActivationInfo, HelperReply, HelperStateName};
use crate::privileged_helper::service::{
    self, RegisterFailure, RegistrationStatus, ReplaceFailure,
};
use crate::privileged_helper::socket_probe::{self, ListenerObservation};
use crate::shared_types::{HelperDecision, HelperPreference};
use crate::state::preferences;
use crate::system::install_location::{self, InstallLocation};
use std::os::unix::net::UnixStream;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;
use tauri::{AppHandle, Runtime};

/// Spacing between `Retire` re-sends. The total is deliberately unbounded: an
/// activation must finish, and a timeout would not be permission to do
/// anything about one that does not.
const RETIRE_RESEND_INTERVAL: Duration = Duration::from_secs(2);

/// Bound on one ServiceManagement call reporting back. The unregister's
/// completion is the signal that the old process was killed, and it is what
/// makes re-registering safe — but exactly-once delivery is a promise of the
/// API, not of the universe, so the slot is never held on silence. Expiry ends
/// the run, which loses nothing: by then the helper is already dead.
const SERVICE_CALL_WINDOW: Duration = Duration::from_secs(30);

/// The window a fresh registration gets to start answering before it is judged
/// missing: twice the window that establishes an absence, and derived from it
/// so the two cannot drift apart.
///
/// It has to be the longer of the two. Confirming an absence only has to
/// outlast a socket that is already gone, while a freshly registered helper
/// still has to be spawned by launchd and bind its socket — reuse the absence
/// numbers here and every fresh install reports a verification failure it
/// recovered from a moment later.
const VERIFY_LISTEN_WINDOW: Duration = socket_probe::POSITIVE_ABSENCE_WINDOW.saturating_mul(2);

/// Spacing between attempts, at the probe's cadence.
const VERIFY_ATTEMPT_INTERVAL: Duration = socket_probe::ABSENCE_ATTEMPT_INTERVAL;

/// The attempts that span that window at that cadence.
const VERIFY_LISTEN_ATTEMPTS: u32 =
    1 + (VERIFY_LISTEN_WINDOW.as_millis() / VERIFY_ATTEMPT_INTERVAL.as_millis()) as u32;

// ---------------------------------------------------------------------------
// What a run reports.
// ---------------------------------------------------------------------------

/// What one run of the function found and did.
///
/// Total: every path out of a run is one of these, so the UI decides by
/// matching. Nothing here is progress or state — a report describes the world
/// at the moment the run ended, and the next run derives its own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reconciled {
    /// A registration exists and an authenticated `Status` reported this
    /// build's ID from `Idle` or a plain `Activating`. The goal is met; the
    /// normal outcome of almost every startup.
    AtThisBuild,
    /// Registered, and macOS is waiting on the user in Login Items — never
    /// approved, or approval revoked. A state, not a failure, and it may
    /// persist for weeks.
    ///
    /// Two passes produce it — the status × goal table's `requiresApproval`
    /// row, which registers nothing, and `verify`, which is reachable only from
    /// a register. The report does not distinguish them, and the UI has one
    /// sentence for both.
    PendingApproval,
    /// No helper is registered and none is wanted: the user disabled it, or
    /// has never decided and there is nothing to adopt. A first-time
    /// registration needs the explicit Grant action.
    NoHelper,
    /// The registration was removed, as the stored decision asks.
    Removed,
    /// A run was already in flight, so this one did nothing at all. A decision
    /// made by the caller is not lost: it is picked up by the run in flight,
    /// which makes one more pass for exactly that reason.
    Busy,
    /// This copy of nixmac may not touch a helper. Nothing was retired,
    /// unregistered, registered, or written.
    Displaced(Displacement),
    /// The run stopped short. Nothing further was mutated; a later run
    /// converges from what it observes then.
    Stopped(Stopped),
}

/// Why a copy of nixmac may not mutate a helper.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Displacement {
    /// Not running from a `.app` bundle whose real path is directly in
    /// `/Applications`. The user is told to move the app; the path is what was
    /// observed, when there was one.
    NotInstalledInApplications(Option<std::path::PathBuf>),
    /// The bundle on disk was replaced while this GUI kept running, so it
    /// would be retiring helpers that its own verification could never
    /// accept. The user is told to restart the app.
    BundleReplaced { running: String, on_disk: String },
}

/// Why a run stopped short of its goal. Each variant is what the report has to
/// say, structurally — no decision anywhere reads display text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Stopped {
    /// `SMAppService` could not be read, so nothing is known to act on.
    RegistrationUnreadable(String),
    /// `notFound`: the bundle's own service definition is broken. Nothing to
    /// register and nothing to remove.
    ServiceDefinitionBroken,
    /// The stored decision could not be read. Inventing one would let an
    /// automatic path adopt or remove a helper the user never ruled on.
    PreferenceUnreadable(String),
    /// The stored decision could not be written, so nothing was done under it.
    PreferenceUnwritable(String),
    /// The bundle's stamped build ID could not be read, so the stale-GUI gate
    /// cannot be answered — and an unanswered gate mutates nothing.
    BundleBuildIdUnreadable(String),
    /// Something holds the helper socket that could not be identified: a
    /// validation that reached no judgment, or a peer that is not root.
    /// Removal decisions are never taken from untrusted observations.
    PeerUnidentified(String),
    /// The socket could not be used and its absence could not be proven
    /// either, so nothing about the helper is established.
    SocketUnusable(String),
    /// A reply arrived that this build cannot parse. Treated exactly like a
    /// refusal: mutate nothing, report, defer.
    HelperUnreadable(String),
    /// An authenticated helper answered something this step cannot act on.
    HelperRefused(HelperReply),
    /// The helper process ended — either the connection this pass was holding
    /// closed, or its socket stopped answering mid-drain. Either way it may
    /// already have been relaunched `Idle`, so it must not be unregistered on
    /// the strength of anything it said before. `interrupted` names the
    /// activation that was running when it went, whose system changes may be
    /// half applied.
    HelperDied { interrupted: Option<ActivationInfo> },
    /// The platform refused to unregister, or never reported inside its window.
    /// A refusal leaves the old registration in place; silence says nothing
    /// about whether it took, and only a fresh observation can.
    UnregisterFailed(String),
    /// The stored decision was no longer `granted` when the register step
    /// re-read it — normally because the user disabled the helper while it was
    /// being retired. The retire and the unregister still happened, and nothing
    /// was registered.
    NoLongerGrantedDuringRun,
    /// A password activation started by this GUI is running, so no
    /// activation-capable helper is registered underneath it.
    PasswordActivationRunning,
    /// The registration was refused by the platform, never reported inside its
    /// window, or refused before it was dispatched at all.
    RegisterFailed(String),
    /// A fresh registration never answered inside its window.
    VerifyNeverAnswered,
    /// What answered was not this build's helper, ready: a different build ID,
    /// or one already retiring or retired.
    VerifyWrongHelper {
        state: HelperStateName,
        build_id: String,
    },
    /// The registration vanished between registering and verifying it.
    VerifyFoundNoRegistration,
}

// The sentences the permissions UI shows. Written here, next to the variants
// they explain, because that is where this app already puts helper detail text
// (`system::permissions` composes the same kind of string and the panel renders
// it verbatim). `system::helper_permission` is what turns one of these into the
// row's detail.

impl std::fmt::Display for Displacement {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotInstalledInApplications(Some(path)) => write!(
                f,
                "nixmac runs from {} — move it to /Applications",
                path.display()
            ),
            Self::NotInstalledInApplications(None) => {
                f.write_str("nixmac is not running from an app bundle in /Applications")
            }
            Self::BundleReplaced { running, on_disk } => write!(
                f,
                "this app was replaced while running (build {running} is running, {on_disk} is installed) — restart nixmac"
            ),
        }
    }
}

impl std::fmt::Display for Stopped {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RegistrationUnreadable(detail) => {
                write!(f, "the helper registration could not be read: {detail}")
            }
            Self::ServiceDefinitionBroken => {
                f.write_str("this app's helper service definition is broken")
            }
            Self::PreferenceUnreadable(detail) => {
                write!(f, "the stored helper decision could not be read: {detail}")
            }
            Self::PreferenceUnwritable(detail) => {
                write!(f, "the helper decision could not be stored: {detail}")
            }
            Self::BundleBuildIdUnreadable(detail) => {
                write!(f, "this app's installed build could not be read: {detail}")
            }
            Self::PeerUnidentified(detail) => {
                write!(
                    f,
                    "the helper socket is held by something unidentified: {detail}"
                )
            }
            Self::SocketUnusable(detail) => write!(f, "the helper socket is unusable: {detail}"),
            Self::HelperUnreadable(detail) => {
                write!(
                    f,
                    "the helper sent a reply this build cannot parse: {detail}"
                )
            }
            Self::HelperRefused(reply) => write!(f, "the helper refused: {}", reply.summary()),
            Self::HelperDied { interrupted: None } => f.write_str("the helper process ended"),
            Self::HelperDied {
                interrupted: Some(activation),
            } => write!(
                f,
                "the helper process ended while running {} — that activation may have been interrupted and the system may be partially changed",
                activation.script_path
            ),
            Self::UnregisterFailed(detail) => {
                write!(f, "the helper could not be unregistered: {detail}")
            }
            Self::NoLongerGrantedDuringRun => {
                f.write_str("the helper is no longer granted; it was being replaced")
            }
            Self::PasswordActivationRunning => {
                f.write_str("an activation started with an administrator password is running")
            }
            Self::RegisterFailed(detail) => {
                write!(f, "the helper could not be registered: {detail}")
            }
            Self::VerifyNeverAnswered => {
                f.write_str("the registered helper never answered on its socket")
            }
            Self::VerifyWrongHelper { state, build_id } => write!(
                f,
                "the registered helper reports {state} at build {build_id}, not this build"
            ),
            Self::VerifyFoundNoRegistration => {
                f.write_str("the helper registration disappeared while it was being verified")
            }
        }
    }
}

impl From<Displacement> for Reconciled {
    fn from(displacement: Displacement) -> Self {
        Self::Displaced(displacement)
    }
}

impl From<Stopped> for Reconciled {
    fn from(stopped: Stopped) -> Self {
        Self::Stopped(stopped)
    }
}

/// A step's outcome. `Ok` is a pass that reached a resting state, `Err` one
/// that ended before the step it was heading for — a stop, a displacement, or
/// (in the one case of an undecided user with nothing to adopt) a resting state
/// reached early. Both channels are terminal and both are reported the same
/// way; the split is what lets `?` end a pass from anywhere without a
/// control-flow enum.
type Step = Result<Reconciled, Reconciled>;

// ---------------------------------------------------------------------------
// The lifecycle mutex: the one lock this function and Apply share.
// ---------------------------------------------------------------------------

/// Serializes three brief decisions that would otherwise race in both
/// directions, because Apply and this function run in the same process:
/// acquiring the single-flight slot, Apply selecting its activation path and
/// recording that a password activation started, and the register step reading
/// that record and committing to register.
///
/// It guards decisions only. It never spans an activation, the `Retire` loop,
/// the unregister callback wait, or Verify — a lock held across any of those
/// would stall the UI for as long as a system activation takes.
pub struct LifecycleMutex {
    sections: Mutex<Sections>,
}

/// What the sections agree about. Three booleans: nothing here is a lifecycle
/// phase, and none of it is persisted.
struct Sections {
    /// A run of the function holds the single-flight slot.
    replacing: bool,
    /// A decision was made while a run was in flight, so that run owes one
    /// more pass. At most one, however many decisions were made: a pass reads
    /// the latest stored value, so one following pass satisfies them all.
    rerun_pending: bool,
    /// Password activations started by this GUI that are still running.
    ///
    /// A count rather than a flag, so two overlapping activations cannot have
    /// the first one to finish clear the record while the second is still
    /// running — after which a registration would be dispatched underneath it.
    password_activations: usize,
}

/// The process-wide instance. Tests construct their own, so nothing here is
/// shared between them.
static SHARED: LifecycleMutex = LifecycleMutex::new();

/// The instance the app uses.
pub fn shared() -> &'static LifecycleMutex {
    &SHARED
}

impl LifecycleMutex {
    pub const fn new() -> Self {
        Self {
            sections: Mutex::new(Sections {
                replacing: false,
                rerun_pending: false,
                password_activations: 0,
            }),
        }
    }

    /// A poison is recovered from rather than propagated. The register step
    /// holds a section across a stored-decision read, so a panic in there can
    /// poison this lock — but no section mutates more than one field, and none
    /// mutates anything before the read that could panic, so there is no
    /// half-applied state to inherit. Refusing instead would leave the app
    /// unable to reconcile or to select an activation path for the rest of the
    /// run.
    fn locked(&self) -> MutexGuard<'_, Sections> {
        self.sections.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Takes the single-flight slot, or reports that a run already holds it.
    ///
    /// A caller that was carrying a decision leaves a re-run pending in the
    /// same locked step that discovers the slot is taken. Doing it afterwards
    /// would leave a gap in which the holder finishes, releases, and never
    /// sees the flag — a user action silently dropped.
    fn try_acquire(&self, trigger: Trigger) -> Option<ReplacementSlot<'_>> {
        let mut sections = self.locked();
        if sections.replacing {
            sections.rerun_pending |= matches!(trigger, Trigger::Decision);
            return None;
        }
        sections.replacing = true;
        Some(ReplacementSlot {
            lifecycle: self,
            released: false,
        })
    }

    /// Either takes the pending re-run — keeping the slot for another pass — or
    /// releases the slot. One locked step, for the same reason as above.
    fn rerun_or_release(&self, slot: &mut ReplacementSlot<'_>) -> bool {
        let mut sections = self.locked();
        if sections.rerun_pending {
            sections.rerun_pending = false;
            return true;
        }
        sections.replacing = false;
        slot.released = true;
        false
    }

    /// Runs one decision inside the shared section. The section lives exactly
    /// as long as the closure: it cannot be stored, returned, or held past the
    /// decision it was entered for. Keep the closure to a decision.
    ///
    /// Lock order, for anything added to a section later: this first, app state
    /// after. The register step reads the stored decision inside a section, so
    /// a caller that took an app-state lock first and this one second would be
    /// the other half of a deadlock.
    ///
    /// The lock is not reentrant: do not call
    /// [`LifecycleMutex::start_password_activation`] from inside the closure —
    /// it takes the same lock. A flow that has to observe and then record calls
    /// that method alone, which is a section of its own and refuses while a
    /// replacement holds the slot.
    pub fn enter<T>(&self, decide: impl FnOnce(&LifecycleSection) -> T) -> T {
        decide(&LifecycleSection(self.locked()))
    }

    /// Records that a password activation started by this GUI is running,
    /// until the returned guard is dropped.
    ///
    /// `Err` means a replacement holds the slot, and is the only answer that
    /// keeps Apply from reading the transient "nothing is registered" between
    /// an unregister and the register that follows it as "no helper here, the
    /// password path is safe". The two orders are therefore the only ones
    /// possible: either Apply finds a replacement in flight and refuses, or
    /// the register step finds this record and ends its run.
    pub fn start_password_activation(&self) -> Result<PasswordActivation<'_>, ReplacementInFlight> {
        let mut sections = self.locked();
        if sections.replacing {
            return Err(ReplacementInFlight);
        }
        sections.password_activations += 1;
        Ok(PasswordActivation { lifecycle: self })
    }
}

/// A replacement is in flight, so no activation path may be selected now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReplacementInFlight;

/// Holds the single-flight slot for one run.
///
/// Only [`LifecycleMutex::try_acquire`] mints one, and `Drop` releases the slot
/// — so every exit path out of a run releases it, a panic included, without any
/// path having to remember to.
pub struct ReplacementSlot<'a> {
    lifecycle: &'a LifecycleMutex,
    released: bool,
}

impl Drop for ReplacementSlot<'_> {
    fn drop(&mut self) {
        if !self.released {
            self.lifecycle.locked().replacing = false;
        }
    }
}

/// The shared section, lent to the closure [`LifecycleMutex::enter`] runs. Its
/// only reader is the register step, which needs the record and the commitment
/// to be one indivisible decision.
pub struct LifecycleSection<'a>(MutexGuard<'a, Sections>);

impl LifecycleSection<'_> {
    pub fn password_activation_running(&self) -> bool {
        self.0.password_activations > 0
    }
}

/// Withdraws one password activation from the record when dropped, so every
/// exit path out of an activation clears its own and only its own.
pub struct PasswordActivation<'a> {
    lifecycle: &'a LifecycleMutex,
}

impl Drop for PasswordActivation<'_> {
    fn drop(&mut self) {
        let mut sections = self.lifecycle.locked();
        sections.password_activations = sections.password_activations.saturating_sub(1);
    }
}

/// Why a run started, which decides exactly one thing: whether finding the
/// slot taken leaves a re-run pending. A decision needs a run that observes
/// it; an observation needs nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Trigger {
    Observation,
    Decision,
}

// ---------------------------------------------------------------------------
// Evidence: what a step is handed rather than asserting for itself.
// ---------------------------------------------------------------------------

/// The two things a step has to be handed rather than assert for itself.
///
/// Their fields are private and this module is, so the mints below are the only
/// way anything gets one: a `RetiredHelper` only exists where a `Retired` reply
/// arrived, and a `Committed` only where the register step's checks ran.
mod evidence {
    use super::HelperReply;

    /// A running helper answered `Retired` — it will never start another
    /// activation — on a connection the caller still holds open.
    pub struct RetiredHelper<C> {
        held: C,
    }

    impl<C> RetiredHelper<C> {
        /// Mints from a `Retired` reply and the connection it arrived on.
        /// Anything else drops that connection: a reply that is not `Retired`
        /// authorizes nothing, and there is no reason to keep the connection
        /// it came on.
        pub fn from_reply(reply: &HelperReply, held: C) -> Option<Self> {
            match reply {
                HelperReply::Retired { .. } => Some(Self { held }),
                _ => None,
            }
        }

        /// The still-open connection, for the liveness check that must happen
        /// immediately before the unregister.
        pub fn held(&self) -> &C {
            &self.held
        }
    }

    /// The register step's immediately-before checks passed. Demanded by every
    /// register, so a registration that skipped them cannot be expressed.
    pub struct Committed(());

    impl Committed {
        /// Minted in one place only: the register step's check function.
        pub(super) fn checked() -> Self {
            Self(())
        }
    }
}

// `Committed` is nameable outside this module because the environment methods
// that demand one are; minting one is not — `Committed::checked` stays visible
// only in here, so the register step remains the only place one comes from.
pub use evidence::Committed;
use evidence::RetiredHelper;

/// Which of the three rules authorizes one unregister.
///
/// Naming a rule is not optional: [`Run::remove`] and [`Run::replace`] take
/// this, so no call site can terminate a helper without saying under what
/// authority — and [`Run::confirm`] re-establishes that authority immediately
/// before the call. The observation behind each variant is checked where the
/// variant is built: the `Retired` reply by the mint that also holds its
/// connection, the absence by a total match on the probe's verdict, and the
/// completed "no" by the client's peer assessment, which is the only thing
/// that produces the reply it comes from.
enum Authorized<C> {
    /// The helper answered `Retired` on a connection still held open.
    Retired(RetiredHelper<C>),
    /// The registration is approval-pending, so no process exists.
    ApprovalPending,
    /// The registration is enabled with positively no listener.
    NoListener,
    /// The peer is root and its validation completed with a "no".
    RootUnverifiable,
}

// ---------------------------------------------------------------------------
// The seam.
// ---------------------------------------------------------------------------

/// One exchange with whatever answers the helper socket.
///
/// The peer assessment is kept apart rather than flattened: what may be done
/// about a helper that cannot be talked to depends entirely on whether
/// validation said "no" or said nothing.
pub enum PeerReply<C> {
    /// Root, validated, and it answered. The connection is handed over still
    /// open, because a `Retired` reply is only good while it stays that way.
    Answered(HelperReply, C),
    /// Root, and validation completed with a "no".
    RootUnverifiable(String),
    /// A peer that is not root, or a validation that reached no judgment.
    Unidentified(String),
    /// The exchange did not happen.
    Failed(HelperClientError),
}

/// Everything a run observes or does, injected so the decisions above can be
/// driven through every case without a helper, a bundle, or a settings store.
///
/// Only observations and effects live here, and no method decides anything about
/// the goal or the helper. Nothing this function does asks for System Settings
/// either: the GUI's `reported` opens Login Items only when a Grant click is
/// waiting for an answer, so what opens it is that click and never a report this
/// function produced. A run that no click is waiting on — startup, a status
/// refresh — therefore opens nothing, whatever it observes.
pub trait Environment {
    /// An answered connection, held open. Opaque: the only thing done with one
    /// is asking whether its peer is still there.
    type Held;

    /// Where this app runs from.
    fn install_location(&self) -> InstallLocation;

    /// The build ID compiled into this process.
    fn compiled_build_id(&self) -> &str;

    /// The build ID stamped into the bundle on disk — the one a registration
    /// would launch. An unreadable stamp is an error, never an empty string
    /// that would compare unequal forever.
    fn bundle_build_id(&self) -> Result<String, String>;

    /// What `SMAppService` reports about nixmac's helper registration.
    fn registration_status(&self) -> Result<RegistrationStatus, String>;

    /// The stored decision about the helper.
    fn preference(&self) -> Result<HelperPreference, String>;

    /// Stores a decision. There is deliberately no way to store "undecided".
    fn store_decision(&self, decision: HelperDecision) -> Result<(), String>;

    /// Whether anything is listening on the helper socket, over the full
    /// absence window. Pure observation: no protocol bytes are written, which
    /// is what makes it safe to point at a helper of any build.
    fn observe_listener(&self) -> ListenerObservation;

    /// Sends `Status` on a fresh connection.
    fn status_exchange(&self) -> PeerReply<Self::Held>;

    /// Sends `Retire` on a fresh connection.
    fn retire_exchange(&self) -> PeerReply<Self::Held>;

    /// Whether the peer of an answered connection is still there. A helper
    /// never closes an authenticated connection, so this is what tells a
    /// caller that the process it is about to unregister is still the one it
    /// spoke to.
    fn peer_still_open(&self, held: &Self::Held) -> bool;

    /// Unregisters, with nothing to be registered afterwards.
    fn unregister(&self) -> Result<(), String>;

    /// Unregisters, waits for the completion that says the old process was
    /// killed, asks `commit_to_register`, and registers the replacement.
    fn replace_helper(
        &self,
        commit_to_register: &dyn Fn() -> Result<Committed, Reconciled>,
    ) -> Result<(), ReplaceFailure<Reconciled>>;

    /// Registers with nothing unregistered first — the path from
    /// `notRegistered`. The token is the proof the immediately-before checks
    /// ran.
    fn register(&self, committed: Committed) -> Result<(), RegisterFailure>;

    /// Waits. Injected so the bounded windows above cost tests nothing.
    fn wait(&self, interval: Duration);

    /// Reports the activation a `Retire` is waiting on, each time it is
    /// observed. The wait is unbounded, so this is the only thing that tells a
    /// user why.
    fn waiting_on_activation(&self, activation: &ActivationInfo);

    /// Reports one pass's outcome. Called for every pass, including the extra
    /// pass a run makes for a decision taken while it was busy — that one has
    /// no caller waiting on its return value, and it is exactly the pass whose
    /// report a Grant action acts on.
    fn reported(&self, outcome: &Reconciled);
}

/// The environment the app runs in.
pub struct LiveEnvironment<'a, R: Runtime> {
    app: &'a AppHandle<R>,
}

impl<'a, R: Runtime> LiveEnvironment<'a, R> {
    pub fn new(app: &'a AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> Environment for LiveEnvironment<'_, R> {
    type Held = UnixStream;

    fn install_location(&self) -> InstallLocation {
        install_location::locate_app_bundle()
    }

    fn compiled_build_id(&self) -> &str {
        protocol::BUILD_ID
    }

    fn bundle_build_id(&self) -> Result<String, String> {
        match install_location::locate_app_bundle() {
            InstallLocation::Canonical(bundle) => build_id::read_bundle_build_id(&bundle),
            // The install gate has already ended any run that reaches this,
            // and a bundle that moved mid-run has no stamp worth comparing.
            InstallLocation::Elsewhere(_) => {
                Err("nixmac is not installed in /Applications".to_string())
            }
        }
    }

    fn registration_status(&self) -> Result<RegistrationStatus, String> {
        service::registration_status().map_err(|error| format!("{error:#}"))
    }

    fn preference(&self) -> Result<HelperPreference, String> {
        preferences::read_helper_preference(self.app).map_err(|error| format!("{error:#}"))
    }

    fn store_decision(&self, decision: HelperDecision) -> Result<(), String> {
        preferences::store_helper_decision(self.app, decision).map_err(|error| format!("{error:#}"))
    }

    fn observe_listener(&self) -> ListenerObservation {
        socket_probe::observe_listener()
    }

    fn status_exchange(&self) -> PeerReply<UnixStream> {
        peer_reply(client::assessed_status())
    }

    fn retire_exchange(&self) -> PeerReply<UnixStream> {
        peer_reply(client::assessed_retire())
    }

    fn peer_still_open(&self, held: &UnixStream) -> bool {
        client::peer_still_open(held)
    }

    fn unregister(&self) -> Result<(), String> {
        service::unregister().map_err(|error| format!("{error:#}"))
    }

    fn replace_helper(
        &self,
        commit_to_register: &dyn Fn() -> Result<Committed, Reconciled>,
    ) -> Result<(), ReplaceFailure<Reconciled>> {
        service::replace_helper(SERVICE_CALL_WINDOW, || {
            commit_to_register().map(|_committed| ())
        })
    }

    fn register(&self, _committed: Committed) -> Result<(), RegisterFailure> {
        service::register_on_later_turn(SERVICE_CALL_WINDOW)
    }

    fn wait(&self, interval: Duration) {
        std::thread::sleep(interval);
    }

    fn waiting_on_activation(&self, activation: &ActivationInfo) {
        log::info!(
            "waiting for the helper's running activation to finish: {} submitted by the {}",
            activation.script_path,
            activation.client_kind
        );
    }

    fn reported(&self, outcome: &Reconciled) {
        log::info!("helper reconciliation: {outcome:?}");
    }
}

fn peer_reply(exchange: Result<AssessedExchange, HelperClientError>) -> PeerReply<UnixStream> {
    match exchange {
        Ok(AssessedExchange::Answered(exchange)) => {
            PeerReply::Answered(exchange.reply, exchange.connection)
        }
        Ok(AssessedExchange::RootUnverifiable(detail)) => PeerReply::RootUnverifiable(detail),
        Ok(AssessedExchange::Unidentified(detail)) => PeerReply::Unidentified(detail),
        Err(error) => PeerReply::Failed(error),
    }
}

// ---------------------------------------------------------------------------
// Entry points.
// ---------------------------------------------------------------------------

/// Reconciles the installed helper with this build. Idempotent, and its normal
/// path is a single `Status` exchange, so running it at startup and on every
/// status refresh is cheap.
pub fn reconcile<E: Environment>(env: &E) -> Reconciled {
    run(shared(), env, Trigger::Observation)
}

/// The explicit Grant action: record the decision, then reconcile under it.
/// First-time registration and repairing a half-finished one are the same
/// step, and the write is idempotent.
///
/// Opening Login Items is the caller's action, never this function's.
pub fn grant<E: Environment>(env: &E) -> Reconciled {
    decide(shared(), env, HelperDecision::Granted)
}

/// The explicit Disable action: record the decision, then reconcile under it.
/// The decision is written first, so a crash halfway resumes the removal
/// rather than repairing the helper.
pub fn disable<E: Environment>(env: &E) -> Reconciled {
    decide(shared(), env, HelperDecision::Disabled)
}

fn decide<E: Environment>(
    lifecycle: &LifecycleMutex,
    env: &E,
    decision: HelperDecision,
) -> Reconciled {
    // A copy that may not mutate a helper may not record a decision about one
    // either — the gates cover the write, not just the effects.
    match gates(env) {
        Ok(()) => {}
        Err(report) => {
            env.reported(&report);
            return report;
        }
    }
    if let Err(detail) = env.store_decision(decision) {
        let report = Stopped::PreferenceUnwritable(detail).into();
        env.reported(&report);
        return report;
    }
    run(lifecycle, env, Trigger::Decision)
}

fn run<E: Environment>(lifecycle: &LifecycleMutex, env: &E, trigger: Trigger) -> Reconciled {
    let Some(mut slot) = lifecycle.try_acquire(trigger) else {
        // Immediate, never a wait. A decision that landed here is not lost:
        // the holder owes it one more pass.
        let report = Reconciled::Busy;
        env.reported(&report);
        return report;
    };
    loop {
        let outcome = Run { lifecycle, env }.pass();
        env.reported(&outcome);
        if !lifecycle.rerun_or_release(&mut slot) {
            return outcome;
        }
    }
}

/// One pass's fixed inputs. Nothing accumulates here: a pass carries no state
/// between its steps beyond what it observes, and none between passes at all.
struct Run<'a, E: Environment> {
    lifecycle: &'a LifecycleMutex,
    env: &'a E,
}

/// What the stored decision asks for. The third stored value, "undecided", is
/// not a goal — it is resolved into one of these, or the pass ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Goal {
    Install,
    Remove,
}

impl<E: Environment> Run<'_, E> {
    fn pass(&self) -> Reconciled {
        self.converge().unwrap_or_else(|report| report)
    }

    fn converge(&self) -> Step {
        gates(self.env)?;
        let status = self.status()?;
        let goal = self.goal(status)?;
        match (status, goal) {
            (RegistrationStatus::NotRegistered, Goal::Install) => self.register_fresh(),
            (RegistrationStatus::NotRegistered, Goal::Remove) => Ok(Reconciled::NoHelper),
            // Approval is a state, not an error: reported, never re-registered,
            // and never a reason to open System Settings. This arm registers
            // nothing, however often it is reached.
            (RegistrationStatus::RequiresApproval, Goal::Install) => {
                Ok(Reconciled::PendingApproval)
            }
            // An approval-pending service has no process, which is what makes
            // this removal safe with no liveness question to answer.
            (RegistrationStatus::RequiresApproval, Goal::Remove) => {
                self.remove(Authorized::ApprovalPending)
            }
            (RegistrationStatus::Enabled, goal) => self.classify(goal),
            // Nothing to register and nothing to remove: the definition this
            // would act on is not there.
            (RegistrationStatus::NotFound, _) => Err(Stopped::ServiceDefinitionBroken.into()),
        }
    }

    fn status(&self) -> Result<RegistrationStatus, Reconciled> {
        self.env
            .registration_status()
            .map_err(|detail| Stopped::RegistrationUnreadable(detail).into())
    }

    /// Resolves the stored decision into a goal, adopting an existing
    /// registration as the user's earlier opt-in.
    ///
    /// The resolution is a write, so the stale-GUI gate applies to it: a GUI
    /// whose bundle was replaced underneath it records nothing.
    fn goal(&self, status: RegistrationStatus) -> Result<Goal, Reconciled> {
        let preference = self
            .env
            .preference()
            .map_err(|detail| Reconciled::from(Stopped::PreferenceUnreadable(detail)))?;
        match preference {
            HelperPreference::Granted => Ok(Goal::Install),
            HelperPreference::Disabled => Ok(Goal::Remove),
            HelperPreference::Unset => match status {
                // A registration that already exists is the user's earlier
                // opt-in — including the pre-contract one, which is what makes
                // the migration automatic. Recorded before anything is
                // mutated, so a crash cannot lose it.
                RegistrationStatus::RequiresApproval | RegistrationStatus::Enabled => {
                    gates(self.env)?;
                    self.env
                        .store_decision(HelperDecision::Granted)
                        .map_err(|detail| {
                            Reconciled::from(Stopped::PreferenceUnwritable(detail))
                        })?;
                    Ok(Goal::Install)
                }
                // Nothing to adopt. A first registration needs the explicit
                // Grant action, never an automatic path.
                RegistrationStatus::NotRegistered => Err(Reconciled::NoHelper),
                // Never resolves the decision; reported as the failure it is.
                RegistrationStatus::NotFound => {
                    Err(Reconciled::from(Stopped::ServiceDefinitionBroken))
                }
            },
        }
    }

    /// What is answering the socket of an `enabled` registration. Exactly one
    /// of four things, and only an authenticated peer is ever spoken to.
    fn classify(&self, goal: Goal) -> Step {
        match self.env.status_exchange() {
            PeerReply::Answered(reply, held) => self.decide_from_status(goal, reply, held),
            // The pre-contract helper, or a tampered one: removed rather than
            // drained, because no reply from it could be trusted. Only a
            // *completed* "no" reaches this arm — a validation that got no
            // answer is `Unidentified` below and authorizes nothing.
            PeerReply::RootUnverifiable(_) => {
                self.remove_or_replace(goal, Authorized::RootUnverifiable)
            }
            PeerReply::Unidentified(detail) => Err(Stopped::PeerUnidentified(detail).into()),
            // Nothing answered. Whether that is an absence — the one
            // observation that authorizes removing a registration without
            // asking anything — takes the full window to establish.
            PeerReply::Failed(HelperClientError::Unreachable(error)) => {
                self.decide_from_absence(goal, error.to_string())
            }
            PeerReply::Failed(error) => Err(self.exchange_failed(error, None)),
        }
    }

    fn decide_from_status(&self, goal: Goal, reply: HelperReply, held: E::Held) -> Step {
        let HelperReply::Status {
            state,
            helper_build_id,
            ..
        } = &reply
        else {
            // A helper of any build answers `Status` with a state. Anything
            // else is a refusal, and refusals are never acted on.
            return Err(Stopped::HelperRefused(reply).into());
        };
        // Byte equality, and nothing else: an empty peer build ID is a
        // perfectly legitimate reply that simply is not this build's, so it
        // takes the different-build path rather than being rejected.
        let this_build = helper_build_id == self.env.compiled_build_id()
            && matches!(state, HelperStateName::Idle | HelperStateName::Activating);
        if this_build && goal == Goal::Install {
            return Ok(Reconciled::AtThisBuild);
        }
        // Every other case — a different build, a helper already retiring or
        // retired, or a removal — asks the helper to stop taking new work
        // first. The discovery connection is not the one that matters: the
        // `Retire` loop opens its own, and rule 1 holds the one that carries
        // `Retired`.
        drop(held);
        self.retire(goal)
    }

    /// Establishes whether an unreachable socket means no listener at all.
    ///
    /// Total over the three verdicts: only the proved absence authorizes a
    /// removal, and everything else — something answering, or nothing
    /// established — leaves the registration alone.
    fn decide_from_absence(&self, goal: Goal, connect_error: String) -> Step {
        match self.env.observe_listener() {
            ListenerObservation::PositivelyAbsent => {
                self.remove_or_replace(goal, Authorized::NoListener)
            }
            ListenerObservation::Listening => Err(Stopped::SocketUnusable(format!(
                "{connect_error}; something is listening on it but did not answer"
            ))
            .into()),
            ListenerObservation::Ambiguous(detail) => {
                Err(Stopped::SocketUnusable(format!("{connect_error}; {detail}")).into())
            }
        }
    }

    /// Asks the helper to retire, for as long as an activation keeps it busy.
    ///
    /// `Busy(X)` is the single outcome waited on without limit — the
    /// activation must finish, and a truly hung one ends at a reboot, not at a
    /// timeout. Everything else ends the pass.
    fn retire(&self, goal: Goal) -> Step {
        // The last activation this pass saw running. If the helper then
        // vanishes, that activation went with it and its changes may be half
        // applied — which the user is told, because nothing else will.
        let mut running: Option<ActivationInfo> = None;
        loop {
            gates(self.env)?;
            match self.env.retire_exchange() {
                PeerReply::Answered(reply, held) => match RetiredHelper::from_reply(&reply, held) {
                    Some(retired) => {
                        return self.remove_or_replace(goal, Authorized::Retired(retired));
                    }
                    None => match reply {
                        HelperReply::Busy { activation } => {
                            self.env.waiting_on_activation(&activation);
                            running = Some(activation);
                            // This connection is already closed: the mint above
                            // took it, declined it, and dropped it. That it
                            // cannot be kept by accident matters — a loop that
                            // held its superseded connections would occupy the
                            // helper's four connection slots and have every
                            // further re-send closed before authentication,
                            // silently and permanently unable to observe the
                            // `Retired` it is waiting for.
                            self.env.wait(RETIRE_RESEND_INTERVAL);
                        }
                        // A helper that answers `Retire` with anything else is
                        // not one this pass can drain.
                        other => return Err(Stopped::HelperRefused(other).into()),
                    },
                },
                // A fresh connection that no longer authenticates: whatever is
                // there now, it is not the helper this pass was draining, and
                // an unverifiable peer found mid-drain is reported rather than
                // removed — the classification that authorizes a removal is
                // made from a fresh observation, at the top of a pass.
                PeerReply::RootUnverifiable(detail) | PeerReply::Unidentified(detail) => {
                    return Err(Stopped::PeerUnidentified(detail).into());
                }
                PeerReply::Failed(error) => {
                    return Err(self.exchange_failed(error, running));
                }
            }
        }
    }

    /// Reads one failed exchange, which is also where a helper that died under
    /// this pass is noticed.
    fn exchange_failed(
        &self,
        error: HelperClientError,
        running: Option<ActivationInfo>,
    ) -> Reconciled {
        match error {
            // Nothing is listening on the socket any more: the helper this pass
            // was talking to is gone, and the activation it was running went
            // with it. It may already have been relaunched `Idle` by launchd,
            // so nothing it said earlier authorizes anything now.
            HelperClientError::Unreachable(_) if running.is_some() => Stopped::HelperDied {
                interrupted: running,
            }
            .into(),
            HelperClientError::Unreachable(error) => {
                Stopped::SocketUnusable(error.to_string()).into()
            }
            // Never a death, even with an activation running a moment ago. A
            // close *before* a reply is the weaker signal: a live helper closes
            // exactly this way when it is at its connection cap or declining a
            // client it could not validate, and reading it as a death would
            // tell the user an activation may have been half applied when
            // nothing was interrupted at all.
            HelperClientError::ClosedBeforeReply => Stopped::SocketUnusable(
                "the helper closed the connection before replying".to_string(),
            )
            .into(),
            HelperClientError::AuthenticationFailed(error) => {
                Stopped::PeerUnidentified(format!("{error:#}")).into()
            }
            HelperClientError::Io(error) => Stopped::SocketUnusable(error.to_string()).into(),
            HelperClientError::UnparseableReply(detail) => Stopped::HelperUnreadable(detail).into(),
        }
    }

    /// Removes the registration, then registers this build's helper if that is
    /// the goal.
    fn remove_or_replace(&self, goal: Goal, authorized: Authorized<E::Held>) -> Step {
        match goal {
            Goal::Install => self.replace(authorized),
            // A recorded Disable is never overridden by an automatic path, the
            // one-time migration of a pre-contract helper included.
            Goal::Remove => self.remove(authorized),
        }
    }

    fn remove(&self, authorized: Authorized<E::Held>) -> Step {
        gates(self.env)?;
        self.confirm(&authorized)?;
        // `authorized` lives until this function returns, so a retired helper's
        // connection is still held while the call below terminates it. That is
        // what makes the check above mean anything: a peer close between them is
        // the window, and it is one call wide.
        self.env
            .unregister()
            .map_err(|detail| Reconciled::from(Stopped::UnregisterFailed(detail)))?;
        Ok(Reconciled::Removed)
    }

    fn replace(&self, authorized: Authorized<E::Held>) -> Step {
        gates(self.env)?;
        self.confirm(&authorized)?;
        // Held through the call, exactly as in [`Self::remove`] — and for
        // longer here, because the unregister this authorizes is issued on the
        // main queue rather than called straight through. That hop is the widest
        // the window between the check and the kill ever gets.
        match self.env.replace_helper(&|| self.commit_to_register()) {
            Ok(()) => self.verify(),
            Err(failure) => Err(match failure {
                // The register step's own report, whatever it was: this pass
                // retired the old helper and unregistered it, and deliberately
                // registered nothing in its place.
                ReplaceFailure::RegisterDeclined(report) => report,
                ReplaceFailure::UnregisterFailed(error) => {
                    Stopped::UnregisterFailed(error.to_string()).into()
                }
                ReplaceFailure::UnregisterSilent => {
                    Stopped::UnregisterFailed("the unregister never reported".to_string()).into()
                }
                ReplaceFailure::RegisterFailed(error) => {
                    Stopped::RegisterFailed(error.to_string()).into()
                }
                ReplaceFailure::RegisterSilent => {
                    Stopped::RegisterFailed("the register never reported".to_string()).into()
                }
                // Refused before anything was dispatched, so nothing changed.
                ReplaceFailure::CalledOnMainThread => Stopped::RegisterFailed(
                    "a helper replacement cannot run on the main thread".to_string(),
                )
                .into(),
            }),
        }
    }

    fn register_fresh(&self) -> Step {
        // The gates are inside the commitment, which is where every register's
        // immediately-before checks live.
        let committed = self.commit_to_register()?;
        self.env.register(committed).map_err(|failure| {
            Reconciled::from(match failure {
                RegisterFailure::Failed(error) => Stopped::RegisterFailed(error.to_string()),
                RegisterFailure::Silent => {
                    Stopped::RegisterFailed("the register never reported".to_string())
                }
                RegisterFailure::CalledOnMainThread => Stopped::RegisterFailed(
                    "a registration cannot run on the main thread".to_string(),
                ),
            })
        })?;
        self.verify()
    }

    /// Re-establishes, immediately before unregistering, the fact that
    /// authorized it. The interval between this and the call is the only
    /// window left, and it is as short as it can be made.
    fn confirm(&self, authorized: &Authorized<E::Held>) -> Result<(), Reconciled> {
        match authorized {
            // The helper answered `Retired` on this connection and a live
            // helper never closes one, so a close means that exact process
            // ended — and launchd may already have relaunched it `Idle`, ready
            // to accept an activation the unregister would then interrupt.
            // A `Retire` is answered `Retired` only from a state with nothing
            // running, so there is no activation to name in this report — a
            // helper that died mid-activation is noticed in the drain instead.
            Authorized::Retired(retired) => {
                if self.env.peer_still_open(retired.held()) {
                    Ok(())
                } else {
                    Err(Stopped::HelperDied { interrupted: None }.into())
                }
            }
            // The absence is re-proved from scratch: launchd's KeepAlive can
            // relaunch a crashed helper at any moment, and this is the only
            // rule whose fact can come back on its own.
            Authorized::NoListener => match self.env.observe_listener() {
                ListenerObservation::PositivelyAbsent => Ok(()),
                ListenerObservation::Listening | ListenerObservation::Ambiguous(_) => {
                    Err(Stopped::SocketUnusable(
                        "something started answering the helper socket".to_string(),
                    )
                    .into())
                }
            },
            // An approval-pending registration has no process to check, and a
            // root peer whose validation completed with a "no" was observed by
            // this pass; neither fact has a liveness question behind it.
            Authorized::ApprovalPending | Authorized::RootUnverifiable => Ok(()),
        }
    }

    /// The register step's immediately-before checks, and the only mint of the
    /// token every register demands.
    ///
    /// Both reads happen inside the shared section, together with the
    /// commitment itself, so Apply cannot slip a password activation between
    /// reading the record and acting on it.
    fn commit_to_register(&self) -> Result<Committed, Reconciled> {
        // A register is a mutation like any other.
        gates(self.env)?;
        self.lifecycle.enter(|section| {
            // A Disable clicked during a long `Retire` loop must not be
            // followed by a fresh registration and its Login Items prompt.
            // This is the one place a decision made mid-pass takes effect in
            // that pass, and it can only ever stop a registration.
            match self.env.preference() {
                Ok(HelperPreference::Granted) => {}
                Ok(HelperPreference::Disabled | HelperPreference::Unset) => {
                    return Err(Stopped::NoLongerGrantedDuringRun.into());
                }
                Err(detail) => return Err(Stopped::PreferenceUnreadable(detail).into()),
            }
            // nixmac never invalidates its own decision: it does not register
            // a helper while a password activation it started is running.
            if section.password_activation_running() {
                return Err(Stopped::PasswordActivationRunning.into());
            }
            Ok(Committed::checked())
        })
    }

    /// Every registration this pass dispatches is verified.
    fn verify(&self) -> Step {
        match self.status()? {
            RegistrationStatus::Enabled => self.verify_listening(),
            settled => Self::verify_from_status(settled),
        }
    }

    /// Judges a dispatched registration from a status read alone.
    ///
    /// Both status reads a verification can make land here: the one above,
    /// whose `enabled` goes to the listen window rather than to a verdict, and
    /// the fresh one taken when that window expires. So the `enabled` arm
    /// belongs to the second read alone — nothing answered, and the
    /// registration still says something should have.
    fn verify_from_status(status: RegistrationStatus) -> Step {
        match status {
            // Registered, and macOS wants the user's approval. Normal.
            RegistrationStatus::RequiresApproval => Ok(Reconciled::PendingApproval),
            RegistrationStatus::NotRegistered => Err(Stopped::VerifyFoundNoRegistration.into()),
            RegistrationStatus::NotFound => Err(Stopped::ServiceDefinitionBroken.into()),
            RegistrationStatus::Enabled => Err(Stopped::VerifyNeverAnswered.into()),
        }
    }

    /// Waits out the listen window for the fresh helper to answer, then judges
    /// what answered. Never a retry loop around a verdict: only a socket that
    /// is not there yet is worth another attempt.
    fn verify_listening(&self) -> Step {
        for attempt in 0..VERIFY_LISTEN_ATTEMPTS {
            if attempt > 0 {
                self.env.wait(VERIFY_ATTEMPT_INTERVAL);
            }
            match self.env.status_exchange() {
                PeerReply::Answered(reply, held) => {
                    drop(held);
                    return self.judge(reply);
                }
                // launchd still has to spawn the helper and let it bind. The
                // one outcome this window exists for.
                PeerReply::Failed(HelperClientError::Unreachable(_)) => continue,
                PeerReply::RootUnverifiable(detail) | PeerReply::Unidentified(detail) => {
                    return Err(Stopped::PeerUnidentified(detail).into());
                }
                PeerReply::Failed(error) => return Err(self.exchange_failed(error, None)),
            }
        }
        // Silence is judged from a fresh read, never from the one that opened
        // the window: a registration can require approval, or be gone, by the
        // time the window ends, and either would be reported as a helper that
        // never answered — a failure — for a state that is not one. The window
        // is the only thing between the two reads, and it is long enough for
        // macOS to have changed its answer inside it.
        Self::verify_from_status(self.status()?)
    }

    fn judge(&self, reply: HelperReply) -> Step {
        match &reply {
            HelperReply::Status {
                state,
                helper_build_id,
                ..
            } => {
                // The allowlist: this build's ID, byte for byte, from a helper
                // that can still activate. `Retiring` and `Retired` are
                // failures — a registration that cannot activate anything is
                // not a replacement.
                if helper_build_id == self.env.compiled_build_id()
                    && matches!(state, HelperStateName::Idle | HelperStateName::Activating)
                {
                    Ok(Reconciled::AtThisBuild)
                } else {
                    Err(Stopped::VerifyWrongHelper {
                        state: *state,
                        build_id: helper_build_id.clone(),
                    }
                    .into())
                }
            }
            _ => Err(Stopped::HelperRefused(reply).into()),
        }
    }
}

/// The two gates in front of every mutation and every write.
///
/// Re-evaluated before each one rather than once per pass: both facts can
/// change while a pass runs — an app can be moved, and a bundle can be
/// replaced by an update — and what they guard is destructive.
///
/// Public for one reason: Apply asks the same question before deciding whether
/// it may touch a helper, and a second implementation of it could disagree with
/// this one.
pub fn gates<E: Environment>(env: &E) -> Result<(), Reconciled> {
    // Canonical install. A copy running from anywhere else observes and
    // reports only: it may not even ask a helper to retire.
    if let InstallLocation::Elsewhere(observed) = env.install_location() {
        return Err(Displacement::NotInstalledInApplications(observed).into());
    }
    // Stale GUI. A bundle replaced underneath this process means the helper it
    // would register is not the one it is compiled to talk to, so it would
    // retire helpers its own verification could never accept.
    let on_disk = env
        .bundle_build_id()
        .map_err(|detail| Reconciled::from(Stopped::BundleBuildIdUnreadable(detail)))?;
    if on_disk != env.compiled_build_id() {
        return Err(Displacement::BundleReplaced {
            running: env.compiled_build_id().to_string(),
            on_disk,
        }
        .into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::privileged_helper::peer_auth::ClientKind;
    use crate::privileged_helper::service::ServiceCallError;
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Barrier};

    const THIS_BUILD: &str = "build-current";
    const OTHER_BUILD: &str = "build-previous";

    // ── the world a pass observes ──────────────────────────────────────────

    /// How the client's assessment of the process on the socket comes out.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum Peer {
        /// Root, and the pinned requirement is satisfied.
        Valid,
        /// Root, and validation completed with a "no": the pre-contract helper.
        RootInvalid,
        /// No judgment could be reached.
        Unjudgeable,
    }

    /// The helper process, as a client of it can see it.
    #[derive(Debug, Clone)]
    struct Helper {
        build_id: String,
        state: HelperStateName,
        activation: Option<ActivationInfo>,
        peer: Peer,
        /// `Retire` answers `Busy` this many more times before it retires.
        busy_rounds: usize,
        /// The process disappears just before answering this many-th further
        /// `Retire` — a crash, or launchd killing it.
        vanishes_before_retire: Option<usize>,
    }

    impl Helper {
        fn ready(build_id: &str) -> Self {
            Self {
                build_id: build_id.to_string(),
                state: HelperStateName::Idle,
                activation: None,
                peer: Peer::Valid,
                busy_rounds: 0,
                vanishes_before_retire: None,
            }
        }

        fn activating(build_id: &str, busy_rounds: usize) -> Self {
            Self {
                state: HelperStateName::Activating,
                activation: Some(activation()),
                busy_rounds,
                ..Self::ready(build_id)
            }
        }
    }

    fn activation() -> ActivationInfo {
        ActivationInfo {
            request_id: "request-1".to_string(),
            script_path: "/nix/store/abc-darwin-system/activate".to_string(),
            client_kind: ClientKind::SyncAgent,
        }
    }

    /// Everything a pass can observe, and the record of what it did.
    struct World {
        status: RegistrationStatus,
        /// What `SMAppService` reports instead once the status has been read
        /// this many times — macOS changing its answer while a pass runs, which
        /// the verification window is long enough for.
        status_changes_after_reads: Option<(usize, RegistrationStatus)>,
        status_reads: usize,
        preference: HelperPreference,
        helper: Option<Helper>,
        install: InstallLocation,
        stamped: Result<String, String>,
        /// What the probe finds, when the helper's absence is not enough to say.
        listener: ListenerObservation,
        /// What it finds instead once it has looked this many times — a helper
        /// launchd relaunched between two observations.
        listener_changes_after_probes: Option<(usize, ListenerObservation)>,
        probes: usize,
        /// The registration and the stored decision cannot be read at all.
        registration_unreadable: bool,
        preference_unreadable: bool,
        /// Answers every `Retire` with this instead of a state reply.
        retire_reply: Option<HelperReply>,
        /// Closes the connection before replying, once this many `Retire` sends
        /// have been answered — what a live helper at its connection cap does.
        retire_closes_after: Option<usize>,
        /// The socket changes hands after this many `Retire` sends.
        peer_changes_after_retires: Option<(usize, Peer)>,
        retire_sends: usize,
        /// Whether the connection a pass holds still has a peer.
        peer_open: bool,
        /// What a registration becomes: `enabled` normally, `requiresApproval`
        /// when macOS wants the user, or one of the two that make it a failure.
        registers_as: RegistrationStatus,
        /// The build the helper a registration launches reports.
        registers_at: String,
        /// The state it reports, so verification can be driven through every
        /// row of its table.
        registers_in: HelperStateName,
        /// Waits before the freshly registered helper starts answering.
        starts_answering_after: usize,
        /// Durable effects still permitted; `Some(0)` cuts the pass short at the
        /// next one, which is how a crash at that boundary is modelled.
        budget: Option<usize>,
        /// The decision changes to this once it has been read this many times —
        /// a Grant or Disable landing mid-pass.
        decision_changes_after_reads: Option<(usize, HelperPreference)>,
        preference_reads: usize,
        /// The bundle on disk is replaced once the stamp has been read this many
        /// times, which lands on one specific gate.
        bundle_replaced_after_reads: Option<usize>,
        stamp_reads: usize,
        events: Vec<Event>,
        reports: Vec<Reconciled>,
    }

    impl Default for World {
        fn default() -> Self {
            Self {
                status: RegistrationStatus::NotRegistered,
                status_changes_after_reads: None,
                status_reads: 0,
                preference: HelperPreference::Unset,
                helper: None,
                install: InstallLocation::Canonical(std::path::PathBuf::from(
                    "/Applications/nixmac.app",
                )),
                stamped: Ok(THIS_BUILD.to_string()),
                listener: ListenerObservation::PositivelyAbsent,
                listener_changes_after_probes: None,
                probes: 0,
                registration_unreadable: false,
                preference_unreadable: false,
                retire_reply: None,
                retire_closes_after: None,
                peer_changes_after_retires: None,
                retire_sends: 0,
                peer_open: true,
                registers_as: RegistrationStatus::Enabled,
                registers_at: THIS_BUILD.to_string(),
                registers_in: HelperStateName::Idle,
                starts_answering_after: 0,
                budget: None,
                decision_changes_after_reads: None,
                preference_reads: 0,
                bundle_replaced_after_reads: None,
                stamp_reads: 0,
                events: Vec::new(),
                reports: Vec::new(),
            }
        }
    }

    /// Everything that happened, in order. Reads that prove an ordering are
    /// here too: a removal that never probed and a decision written before the
    /// helper was touched are both assertions about this sequence.
    #[derive(Debug, Clone, PartialEq, Eq)]
    enum Event {
        /// One evaluation of the stale-bundle gate — recorded so a test can see
        /// where the gates sit relative to what they guard, not just that they
        /// fire.
        GateRead,
        StoredDecision(HelperDecision),
        StatusAsked,
        RetireSent,
        Probed,
        Waited(Duration),
        WaitingOn(String),
        /// A removal with nothing registered afterwards.
        Unregistered,
        /// The unregister half of a replacement, with the number of connections
        /// the pass still holds open at that moment: rule 1's proof that the
        /// helper it is terminating is still the one that retired.
        ReplacementUnregistered {
            holding: usize,
        },
        Registered,
    }

    /// The durable effects — what a crash-resume or a mutated-nothing assertion
    /// is about, as opposed to the observations around them.
    fn is_mutation(event: &Event) -> bool {
        matches!(
            event,
            Event::StoredDecision(_)
                | Event::Unregistered
                | Event::ReplacementUnregistered { .. }
                | Event::Registered
        )
    }

    /// A connection handed to a pass. Dropping it is closing it, and that is
    /// recorded: a `Retire` loop that kept superseded connections would reach
    /// the helper's connection cap and never see the reply it waits for.
    struct FakeConnection {
        open: Arc<Mutex<HashSet<usize>>>,
        id: usize,
    }

    impl Drop for FakeConnection {
        fn drop(&mut self) {
            self.open.lock().expect("open connections").remove(&self.id);
        }
    }

    /// Blocks a pass at its next wait until the test lets it go.
    struct PauseGate {
        reached: Barrier,
        release: Barrier,
        spent: AtomicBool,
    }

    impl PauseGate {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                reached: Barrier::new(2),
                release: Barrier::new(2),
                spent: AtomicBool::new(false),
            })
        }
    }

    struct Fake {
        world: Mutex<World>,
        open: Arc<Mutex<HashSet<usize>>>,
        next_connection: Mutex<usize>,
        pause: Option<Arc<PauseGate>>,
    }

    impl Fake {
        fn new(world: World) -> Self {
            Self {
                world: Mutex::new(world),
                open: Arc::new(Mutex::new(HashSet::new())),
                next_connection: Mutex::new(0),
                pause: None,
            }
        }

        fn paused_by(world: World, pause: &Arc<PauseGate>) -> Self {
            Self {
                pause: Some(Arc::clone(pause)),
                ..Self::new(world)
            }
        }

        fn world(&self) -> MutexGuard<'_, World> {
            self.world.lock().expect("world")
        }

        fn events(&self) -> Vec<Event> {
            self.world().events.clone()
        }

        /// Everything but the observations, which is what a crash-resume or a
        /// mutated-nothing assertion is about.
        fn mutations(&self) -> Vec<Event> {
            self.events().into_iter().filter(is_mutation).collect()
        }

        fn counted(&self, wanted: &Event) -> usize {
            self.events()
                .iter()
                .filter(|event| *event == wanted)
                .count()
        }

        /// Passes that actually ran, as opposed to callers turned away.
        fn passes(&self) -> usize {
            self.world()
                .reports
                .iter()
                .filter(|report| **report != Reconciled::Busy)
                .count()
        }

        fn refusals(&self) -> usize {
            self.world()
                .reports
                .iter()
                .filter(|report| **report == Reconciled::Busy)
                .count()
        }

        fn hand_over_connection(&self) -> FakeConnection {
            let mut next = self.next_connection.lock().expect("connection ids");
            *next += 1;
            self.open.lock().expect("open connections").insert(*next);
            FakeConnection {
                open: Arc::clone(&self.open),
                id: *next,
            }
        }

        fn holding(&self) -> usize {
            self.open.lock().expect("open connections").len()
        }

        /// One exchange with whatever is on the socket, sending nothing to a
        /// peer that is not authenticated.
        fn exchange(
            &self,
            reply: impl FnOnce(&mut Helper) -> HelperReply,
        ) -> PeerReply<FakeConnection> {
            let mut world = self.world();
            let Some(helper) = world.helper.as_mut() else {
                return PeerReply::Failed(HelperClientError::Unreachable(std::io::Error::from(
                    std::io::ErrorKind::NotFound,
                )));
            };
            match helper.peer {
                Peer::RootInvalid => PeerReply::RootUnverifiable("unsigned".to_string()),
                Peer::Unjudgeable => PeerReply::Unidentified("validation failed".to_string()),
                Peer::Valid => {
                    let reply = reply(helper);
                    drop(world);
                    PeerReply::Answered(reply, self.hand_over_connection())
                }
            }
        }
    }

    impl World {
        /// Applies one durable effect, or refuses it because this pass's budget
        /// is spent — the effect does not happen and the pass ends there, which
        /// is exactly what a crash at that boundary leaves behind.
        fn durable(&mut self, event: Event) -> Result<(), String> {
            match &mut self.budget {
                Some(0) => return Err("the pass was cut short here".to_string()),
                Some(remaining) => *remaining -= 1,
                None => {}
            }
            self.events.push(event);
            Ok(())
        }

        /// A registration takes effect, and launchd spawns the helper behind it
        /// — not necessarily at once, which is the whole reason verification
        /// has a window.
        fn finish_registration(&mut self) {
            self.status = self.registers_as;
            if self.registers_as == RegistrationStatus::Enabled && self.starts_answering_after == 0
            {
                self.spawn_helper();
            }
        }

        fn spawn_helper(&mut self) {
            self.helper = Some(Helper {
                state: self.registers_in,
                activation: matches!(
                    self.registers_in,
                    HelperStateName::Activating | HelperStateName::Retiring
                )
                .then(activation),
                ..Helper::ready(&self.registers_at)
            });
        }
    }

    impl Environment for Fake {
        type Held = FakeConnection;

        fn install_location(&self) -> InstallLocation {
            self.world().install.clone()
        }

        fn compiled_build_id(&self) -> &str {
            THIS_BUILD
        }

        fn bundle_build_id(&self) -> Result<String, String> {
            let mut world = self.world();
            world.events.push(Event::GateRead);
            world.stamp_reads += 1;
            if let Some(after) = world.bundle_replaced_after_reads
                && world.stamp_reads > after
            {
                return Ok(OTHER_BUILD.to_string());
            }
            world.stamped.clone()
        }

        fn registration_status(&self) -> Result<RegistrationStatus, String> {
            let mut world = self.world();
            if world.registration_unreadable {
                return Err("SMAppService could not be read".to_string());
            }
            world.status_reads += 1;
            if let Some((after, changed)) = world.status_changes_after_reads
                && world.status_reads > after
            {
                world.status = changed;
            }
            Ok(world.status)
        }

        fn preference(&self) -> Result<HelperPreference, String> {
            let mut world = self.world();
            if world.preference_unreadable {
                return Err("the settings store is not there".to_string());
            }
            world.preference_reads += 1;
            if let Some((after, changed)) = world.decision_changes_after_reads
                && world.preference_reads > after
            {
                world.preference = changed;
            }
            Ok(world.preference)
        }

        fn store_decision(&self, decision: HelperDecision) -> Result<(), String> {
            let mut world = self.world();
            world.durable(Event::StoredDecision(decision))?;
            world.preference = decision.into();
            Ok(())
        }

        fn observe_listener(&self) -> ListenerObservation {
            let mut world = self.world();
            world.events.push(Event::Probed);
            world.probes += 1;
            if let Some((after, changed)) = world.listener_changes_after_probes.clone()
                && world.probes > after
            {
                world.listener = changed;
            }
            world.listener.clone()
        }

        fn status_exchange(&self) -> PeerReply<FakeConnection> {
            self.world().events.push(Event::StatusAsked);
            self.exchange(|helper| HelperReply::Status {
                state: helper.state,
                helper_build_id: helper.build_id.clone(),
                activation: helper.activation.clone(),
            })
        }

        fn retire_exchange(&self) -> PeerReply<FakeConnection> {
            {
                let mut world = self.world();
                world.events.push(Event::RetireSent);
                world.retire_sends += 1;
                // Something else answering the socket a re-send later.
                if let Some((after, peer)) = world.peer_changes_after_retires
                    && world.retire_sends > after
                    && let Some(helper) = world.helper.as_mut()
                {
                    helper.peer = peer;
                }
                // A helper that goes away between two re-sends.
                if let Some(helper) = world.helper.as_mut() {
                    match helper.vanishes_before_retire {
                        Some(0) => world.helper = None,
                        Some(sends) => helper.vanishes_before_retire = Some(sends - 1),
                        None => {}
                    }
                }
                if let Some(after) = world.retire_closes_after
                    && world.retire_sends > after
                {
                    return PeerReply::Failed(HelperClientError::ClosedBeforeReply);
                }
                if let Some(reply) = world.retire_reply.clone() {
                    drop(world);
                    return PeerReply::Answered(reply, self.hand_over_connection());
                }
            }
            self.exchange(|helper| {
                if helper.busy_rounds > 0 {
                    helper.busy_rounds -= 1;
                    // Retirement latches the moment it is asked for.
                    helper.state = HelperStateName::Retiring;
                    return HelperReply::Busy {
                        activation: helper.activation.clone().unwrap_or_else(activation),
                    };
                }
                helper.state = HelperStateName::Retired;
                helper.activation = None;
                HelperReply::Retired { activation: None }
            })
        }

        fn peer_still_open(&self, _held: &FakeConnection) -> bool {
            self.world().peer_open
        }

        fn unregister(&self) -> Result<(), String> {
            let mut world = self.world();
            world.durable(Event::Unregistered)?;
            world.helper = None;
            world.status = RegistrationStatus::NotRegistered;
            Ok(())
        }

        fn replace_helper(
            &self,
            commit_to_register: &dyn Fn() -> Result<Committed, Reconciled>,
        ) -> Result<(), ReplaceFailure<Reconciled>> {
            {
                let holding = self.holding();
                let mut world = self.world();
                world
                    .durable(Event::ReplacementUnregistered { holding })
                    .map_err(|detail| ReplaceFailure::UnregisterFailed(refusal(detail)))?;
                // The completion that says the old process was killed. Between
                // it and the register, nothing is registered at all.
                world.helper = None;
                world.status = RegistrationStatus::NotRegistered;
            }
            commit_to_register().map_err(ReplaceFailure::RegisterDeclined)?;
            let mut world = self.world();
            world
                .durable(Event::Registered)
                .map_err(|detail| ReplaceFailure::RegisterFailed(refusal(detail)))?;
            world.finish_registration();
            Ok(())
        }

        fn register(&self, _committed: Committed) -> Result<(), RegisterFailure> {
            let mut world = self.world();
            world
                .durable(Event::Registered)
                .map_err(|detail| RegisterFailure::Failed(refusal(detail)))?;
            world.finish_registration();
            Ok(())
        }

        fn wait(&self, interval: Duration) {
            {
                let mut world = self.world();
                world.events.push(Event::Waited(interval));
                // A registered helper launchd has now had time to spawn.
                if world.starts_answering_after > 0 {
                    world.starts_answering_after -= 1;
                    if world.starts_answering_after == 0
                        && world.status == RegistrationStatus::Enabled
                    {
                        world.spawn_helper();
                    }
                }
            }
            // Nothing above is held while the pass is parked here, so a
            // concurrent caller can reach the function.
            if let Some(pause) = &self.pause
                && !pause.spent.swap(true, Ordering::SeqCst)
            {
                pause.reached.wait();
                pause.release.wait();
            }
        }

        fn waiting_on_activation(&self, activation: &ActivationInfo) {
            self.world()
                .events
                .push(Event::WaitingOn(activation.script_path.clone()));
        }

        fn reported(&self, outcome: &Reconciled) {
            self.world().reports.push(outcome.clone());
        }
    }

    fn refusal(detail: String) -> ServiceCallError {
        ServiceCallError {
            domain: "SMAppServiceErrorDomain".to_string(),
            code: 1,
            localized: detail,
        }
    }

    /// One pass, on its own lifecycle mutex so nothing is shared between tests.
    fn reconciled(fake: &Fake) -> Reconciled {
        run(&LifecycleMutex::new(), fake, Trigger::Observation)
    }

    fn stopped(reason: Stopped) -> Reconciled {
        Reconciled::Stopped(reason)
    }

    // ── the decision table ────────────────────────────────────────────────

    #[test]
    fn the_table_covers_every_registration_state_under_every_decision() {
        // Twelve rows, and no catch-all anywhere behind them: a fifth status or
        // a fourth decision would have to be answered here rather than fall
        // through to something that mutates.
        let rows = [
            // Nothing registered.
            (
                RegistrationStatus::NotRegistered,
                HelperPreference::Granted,
                Reconciled::AtThisBuild,
                vec![Event::Registered],
            ),
            (
                RegistrationStatus::NotRegistered,
                HelperPreference::Disabled,
                Reconciled::NoHelper,
                vec![],
            ),
            (
                RegistrationStatus::NotRegistered,
                HelperPreference::Unset,
                Reconciled::NoHelper,
                vec![],
            ),
            // Registered, waiting on the user, and nothing registered to get
            // here — which is what the empty mutation list says.
            (
                RegistrationStatus::RequiresApproval,
                HelperPreference::Granted,
                Reconciled::PendingApproval,
                vec![],
            ),
            (
                RegistrationStatus::RequiresApproval,
                HelperPreference::Disabled,
                Reconciled::Removed,
                vec![Event::Unregistered],
            ),
            (
                RegistrationStatus::RequiresApproval,
                HelperPreference::Unset,
                Reconciled::PendingApproval,
                vec![Event::StoredDecision(HelperDecision::Granted)],
            ),
            // Registered and running this build's helper.
            (
                RegistrationStatus::Enabled,
                HelperPreference::Granted,
                Reconciled::AtThisBuild,
                vec![],
            ),
            (
                RegistrationStatus::Enabled,
                HelperPreference::Disabled,
                Reconciled::Removed,
                vec![Event::Unregistered],
            ),
            (
                RegistrationStatus::Enabled,
                HelperPreference::Unset,
                Reconciled::AtThisBuild,
                vec![Event::StoredDecision(HelperDecision::Granted)],
            ),
            // The bundle's own service definition is broken: nothing to
            // register, nothing to remove, and the decision is not resolved.
            (
                RegistrationStatus::NotFound,
                HelperPreference::Granted,
                stopped(Stopped::ServiceDefinitionBroken),
                vec![],
            ),
            (
                RegistrationStatus::NotFound,
                HelperPreference::Disabled,
                stopped(Stopped::ServiceDefinitionBroken),
                vec![],
            ),
            (
                RegistrationStatus::NotFound,
                HelperPreference::Unset,
                stopped(Stopped::ServiceDefinitionBroken),
                vec![],
            ),
        ];

        for (status, preference, expected, mutations) in rows {
            let fake = Fake::new(World {
                status,
                preference,
                helper: (status == RegistrationStatus::Enabled).then(|| Helper::ready(THIS_BUILD)),
                ..World::default()
            });

            assert_eq!(reconciled(&fake), expected, "{status} under {preference:?}");
            assert_eq!(
                fake.mutations(),
                mutations,
                "{status} under {preference:?} mutated the wrong things"
            );
        }
    }

    #[test]
    fn an_existing_registration_is_adopted_before_anything_else_happens() {
        // The one-time migration's opt-in, and the order that makes it safe: the
        // decision is stored before the helper is touched, so a crash in the
        // middle leaves the opt-in behind rather than losing it.
        let fake = Fake::new(World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Unset,
            helper: Some(Helper {
                peer: Peer::RootInvalid,
                ..Helper::ready("")
            }),
            ..World::default()
        });

        assert_eq!(reconciled(&fake), Reconciled::AtThisBuild);

        assert_eq!(
            fake.mutations(),
            vec![
                Event::StoredDecision(HelperDecision::Granted),
                Event::ReplacementUnregistered { holding: 0 },
                Event::Registered,
            ]
        );
    }

    #[test]
    fn a_first_registration_is_never_automatic() {
        // Nothing to adopt: only the explicit Grant action may register a
        // helper for the first time, so an undecided user gets no registration
        // and no stored decision either.
        let fake = Fake::new(World::default());

        assert_eq!(reconciled(&fake), Reconciled::NoHelper);
        assert_eq!(fake.mutations(), vec![]);
    }

    // ── classifying what holds the socket ─────────────────────────────────

    #[test]
    fn a_helper_at_this_build_that_can_still_activate_is_left_alone() {
        for state in [HelperStateName::Idle, HelperStateName::Activating] {
            let fake = Fake::new(World {
                status: RegistrationStatus::Enabled,
                preference: HelperPreference::Granted,
                helper: Some(Helper {
                    state,
                    activation: (state == HelperStateName::Activating).then(activation),
                    ..Helper::ready(THIS_BUILD)
                }),
                ..World::default()
            });

            assert_eq!(reconciled(&fake), Reconciled::AtThisBuild, "{state}");
            assert_eq!(fake.mutations(), vec![], "{state}");
            assert_eq!(fake.counted(&Event::RetireSent), 0, "{state}");
        }
    }

    #[test]
    fn every_helper_that_is_not_this_build_ready_is_replaced() {
        // A different build, and this build already retiring or retired: a
        // registration that cannot activate for this GUI is replaced, not kept.
        // The empty build ID is in here deliberately — it is a legitimate reply
        // that simply is not this build's, and treating it as unparseable would
        // turn a diagnosable mismatch into a dead end.
        for (build_id, state) in [
            (OTHER_BUILD, HelperStateName::Idle),
            (OTHER_BUILD, HelperStateName::Activating),
            ("", HelperStateName::Idle),
            (THIS_BUILD, HelperStateName::Retiring),
            (THIS_BUILD, HelperStateName::Retired),
        ] {
            let fake = Fake::new(World {
                status: RegistrationStatus::Enabled,
                preference: HelperPreference::Granted,
                helper: Some(Helper {
                    state,
                    activation: matches!(
                        state,
                        HelperStateName::Activating | HelperStateName::Retiring
                    )
                    .then(activation),
                    ..Helper::ready(build_id)
                }),
                ..World::default()
            });

            assert_eq!(
                reconciled(&fake),
                Reconciled::AtThisBuild,
                "build {build_id} in {state}"
            );
            assert_eq!(
                fake.mutations(),
                vec![
                    Event::ReplacementUnregistered { holding: 1 },
                    Event::Registered
                ],
                "build {build_id} in {state}"
            );
        }
    }

    #[test]
    fn a_peer_that_cannot_be_identified_is_reported_and_nothing_is_touched() {
        // A validation that reached no judgment, and — through the same arm — a
        // peer that is not root. Neither is a "no", so neither authorizes
        // removing anything.
        for preference in [HelperPreference::Granted, HelperPreference::Disabled] {
            let fake = Fake::new(World {
                status: RegistrationStatus::Enabled,
                preference,
                helper: Some(Helper {
                    peer: Peer::Unjudgeable,
                    ..Helper::ready(THIS_BUILD)
                }),
                ..World::default()
            });

            assert_eq!(
                reconciled(&fake),
                stopped(Stopped::PeerUnidentified("validation failed".to_string())),
                "{preference:?}"
            );
            assert_eq!(fake.mutations(), vec![], "{preference:?}");
        }
    }

    #[test]
    fn the_pre_contract_helper_is_removed_without_being_asked_anything() {
        // It predates the control protocol and cannot retire, so it is removed
        // directly — and not one protocol byte is written to it. Under a
        // recorded Disable it is removed and nothing replaces it: a decision to
        // disable is never overridden by the migration.
        for (preference, expected, mutations) in [
            (
                HelperPreference::Granted,
                Reconciled::AtThisBuild,
                vec![
                    Event::ReplacementUnregistered { holding: 0 },
                    Event::Registered,
                ],
            ),
            (
                HelperPreference::Disabled,
                Reconciled::Removed,
                vec![Event::Unregistered],
            ),
        ] {
            let fake = Fake::new(World {
                status: RegistrationStatus::Enabled,
                preference,
                helper: Some(Helper {
                    peer: Peer::RootInvalid,
                    ..Helper::ready("")
                }),
                ..World::default()
            });

            assert_eq!(reconciled(&fake), expected, "{preference:?}");
            assert_eq!(fake.mutations(), mutations, "{preference:?}");
            assert_eq!(fake.counted(&Event::RetireSent), 0, "{preference:?}");
        }
    }

    #[test]
    fn an_approval_pending_registration_is_removed_without_a_process_check() {
        // There is no process behind an approval-pending registration, so there
        // is nothing to prove absent and nothing to retire.
        let fake = Fake::new(World {
            status: RegistrationStatus::RequiresApproval,
            preference: HelperPreference::Disabled,
            ..World::default()
        });

        assert_eq!(reconciled(&fake), Reconciled::Removed);
        assert_eq!(fake.mutations(), vec![Event::Unregistered]);
        assert_eq!(fake.counted(&Event::Probed), 0);
        assert_eq!(fake.counted(&Event::RetireSent), 0);
    }

    #[test]
    fn an_absence_authorizes_a_removal_and_is_proved_twice() {
        // The window establishes it, and it is re-established immediately before
        // the unregister: launchd's KeepAlive can relaunch a crashed helper at
        // any moment, and this is the only authority that can come back on its
        // own.
        let fake = Fake::new(World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Granted,
            helper: None,
            listener: ListenerObservation::PositivelyAbsent,
            ..World::default()
        });

        assert_eq!(reconciled(&fake), Reconciled::AtThisBuild);

        assert_eq!(fake.counted(&Event::Probed), 2);
        assert_eq!(
            fake.mutations(),
            vec![
                Event::ReplacementUnregistered { holding: 0 },
                Event::Registered
            ]
        );
    }

    #[test]
    fn anything_short_of_a_proved_absence_removes_nothing() {
        for observation in [
            ListenerObservation::Listening,
            ListenerObservation::Ambiguous("timed out".to_string()),
        ] {
            let fake = Fake::new(World {
                status: RegistrationStatus::Enabled,
                preference: HelperPreference::Granted,
                helper: None,
                listener: observation.clone(),
                ..World::default()
            });

            assert!(
                matches!(
                    reconciled(&fake),
                    Reconciled::Stopped(Stopped::SocketUnusable(_))
                ),
                "{observation:?}"
            );
            assert_eq!(fake.mutations(), vec![], "{observation:?}");
        }
    }

    #[test]
    fn an_absence_that_comes_back_before_the_unregister_stops_the_pass() {
        // The residual window this second observation exists to shrink:
        // launchd's KeepAlive relaunched the helper between the two, so the
        // removal has lost its authority and the pass must not use it anyway.
        let fake = Fake::new(World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Granted,
            helper: None,
            listener: ListenerObservation::PositivelyAbsent,
            listener_changes_after_probes: Some((1, ListenerObservation::Listening)),
            ..World::default()
        });

        assert_eq!(
            reconciled(&fake),
            stopped(Stopped::SocketUnusable(
                "something started answering the helper socket".to_string()
            ))
        );
        assert_eq!(fake.counted(&Event::Probed), 2);
        assert_eq!(fake.mutations(), vec![]);
    }

    // ── retiring ──────────────────────────────────────────────────────────

    #[test]
    fn only_a_busy_reply_keeps_the_retire_loop_going() {
        // The activation must finish, so this is the one outcome waited on
        // without limit — and the wait is reported each round, because nothing
        // else tells the user why the app is sitting there.
        let fake = Fake::new(World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Granted,
            helper: Some(Helper::activating(OTHER_BUILD, 3)),
            ..World::default()
        });

        assert_eq!(reconciled(&fake), Reconciled::AtThisBuild);

        assert_eq!(fake.counted(&Event::RetireSent), 4);
        assert_eq!(fake.counted(&Event::WaitingOn(activation().script_path)), 3);
        assert_eq!(fake.counted(&Event::Waited(RETIRE_RESEND_INTERVAL)), 3);
        // Each re-send is a fresh connection and the superseded ones are closed
        // as they are superseded: only the one that carried `Retired` is still
        // open when the helper is unregistered. A loop that kept them would
        // reach the helper's four-connection cap and then never see `Retired`
        // at all.
        assert_eq!(
            fake.mutations(),
            vec![
                Event::ReplacementUnregistered { holding: 1 },
                Event::Registered
            ]
        );
    }

    #[test]
    fn every_reply_but_busy_and_retired_ends_the_pass() {
        // A helper that answers a `Retire` with anything else cannot be drained,
        // and a refusal is never a licence to remove it anyway. The state
        // replies are in here too: `Status`-shaped answers to a `Retire` are
        // just as much a reply this step cannot act on.
        for reply in [
            HelperReply::BuildMismatch {
                helper_build_id: OTHER_BUILD.to_string(),
            },
            HelperReply::CallerNotPermitted,
            HelperReply::RequestNotUnderstood,
            HelperReply::Status {
                state: HelperStateName::Idle,
                helper_build_id: OTHER_BUILD.to_string(),
                activation: None,
            },
        ] {
            let fake = Fake::new(World {
                status: RegistrationStatus::Enabled,
                preference: HelperPreference::Granted,
                helper: Some(Helper::ready(OTHER_BUILD)),
                retire_reply: Some(reply.clone()),
                ..World::default()
            });

            assert_eq!(
                reconciled(&fake),
                stopped(Stopped::HelperRefused(reply.clone())),
                "{reply:?}"
            );
            assert_eq!(fake.mutations(), vec![], "{reply:?}");
            assert_eq!(fake.counted(&Event::RetireSent), 1, "{reply:?}");
        }
    }

    #[test]
    fn a_helper_that_dies_mid_drain_reports_the_activation_it_took_with_it() {
        // The activation was running as root when the process went, so the
        // system may be half changed — and nobody else is going to say so.
        let fake = Fake::new(World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Granted,
            helper: Some(Helper {
                vanishes_before_retire: Some(1),
                ..Helper::activating(OTHER_BUILD, 3)
            }),
            ..World::default()
        });

        assert_eq!(
            reconciled(&fake),
            stopped(Stopped::HelperDied {
                interrupted: Some(activation()),
            })
        );
        assert_eq!(fake.mutations(), vec![]);
    }

    #[test]
    fn a_connection_closed_before_a_reply_is_never_read_as_a_death() {
        // The weaker signal, and the reason it has to stay weaker: a live helper
        // at its connection cap — or one declining a client it could not
        // validate — closes exactly this way, and the cap is reachable on
        // purpose during a replacement. Reading it as a death would tell the
        // user an activation may have been half applied while it is in fact
        // still running.
        let fake = Fake::new(World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Granted,
            helper: Some(Helper::activating(OTHER_BUILD, 5)),
            retire_closes_after: Some(1),
            ..World::default()
        });

        let outcome = reconciled(&fake);

        assert_eq!(
            outcome,
            stopped(Stopped::SocketUnusable(
                "the helper closed the connection before replying".to_string()
            ))
        );
        assert!(
            !matches!(outcome, Reconciled::Stopped(Stopped::HelperDied { .. })),
            "a helper that is merely out of connection slots was reported dead"
        );
        assert_eq!(fake.mutations(), vec![]);
    }

    #[test]
    fn a_peer_that_stops_authenticating_mid_drain_is_reported_never_removed() {
        // Whatever is on the socket now, it is not the helper this pass was
        // draining. The classification that authorizes a removal is made from a
        // fresh observation at the top of a pass, never from one that appears
        // in the middle of a drain.
        // The socket changes hands after the first `Busy`: what is there now is
        // a root process whose validation says "no" — which at the top of a
        // pass would authorize removing it, and here does not.
        let fake = Fake::new(World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Granted,
            helper: Some(Helper::activating(OTHER_BUILD, 5)),
            peer_changes_after_retires: Some((1, Peer::RootInvalid)),
            ..World::default()
        });

        assert_eq!(
            reconciled(&fake),
            stopped(Stopped::PeerUnidentified("unsigned".to_string()))
        );
        assert_eq!(fake.mutations(), vec![]);
    }

    #[test]
    fn the_retired_connection_is_checked_immediately_before_the_unregister() {
        // The helper answered `Retired`, then its process ended — launchd may
        // already have relaunched it, `Idle` and ready to accept an activation
        // that the unregister would then interrupt. So the pass abandons the
        // removal and reports it.
        let fake = Fake::new(World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Granted,
            helper: Some(Helper::ready(OTHER_BUILD)),
            peer_open: false,
            ..World::default()
        });

        assert_eq!(
            reconciled(&fake),
            stopped(Stopped::HelperDied { interrupted: None })
        );
        assert_eq!(fake.mutations(), vec![]);
    }

    // ── registering ───────────────────────────────────────────────────────

    #[test]
    fn a_decision_to_disable_taken_mid_pass_stops_the_registration() {
        // A Disable clicked during a long drain must not be followed by a fresh
        // registration and its Login Items prompt. The retire and the
        // unregister still happened — they only ever remove — and nothing was
        // registered in their place.
        let fake = Fake::new(World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Granted,
            helper: Some(Helper::activating(OTHER_BUILD, 1)),
            // The register step's own re-read is the second one this pass makes.
            decision_changes_after_reads: Some((1, HelperPreference::Disabled)),
            ..World::default()
        });

        assert_eq!(
            reconciled(&fake),
            stopped(Stopped::NoLongerGrantedDuringRun)
        );
        assert_eq!(
            fake.mutations(),
            vec![Event::ReplacementUnregistered { holding: 1 }]
        );
    }

    #[test]
    fn no_helper_is_registered_underneath_this_guis_own_password_activation() {
        // nixmac never invalidates its own decision: an activation it started
        // with an administrator password is running, so it registers nothing
        // that could admit another one alongside it.
        let lifecycle = LifecycleMutex::new();
        let running = lifecycle
            .start_password_activation()
            .expect("no replacement is in flight yet");
        let fake = Fake::new(World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Granted,
            helper: Some(Helper::ready(OTHER_BUILD)),
            ..World::default()
        });

        let outcome = run(&lifecycle, &fake, Trigger::Observation);

        assert_eq!(outcome, stopped(Stopped::PasswordActivationRunning));
        assert_eq!(
            fake.mutations(),
            vec![Event::ReplacementUnregistered { holding: 1 }]
        );
        drop(running);

        // With the activation finished, the next pass converges.
        assert_eq!(
            run(&lifecycle, &fake, Trigger::Observation),
            Reconciled::AtThisBuild
        );
    }

    #[test]
    fn a_replacement_is_refused_while_a_password_activation_is_running() {
        // The other order, and the only one left: Apply cannot start a password
        // activation while a replacement holds the slot, so it can never read
        // the moment between an unregister and its register as "no helper here".
        let lifecycle = LifecycleMutex::new();
        let slot = lifecycle
            .try_acquire(Trigger::Observation)
            .expect("the slot is free");

        assert_eq!(
            lifecycle.start_password_activation().err(),
            Some(ReplacementInFlight)
        );

        drop(slot);
        assert!(lifecycle.start_password_activation().is_ok());
    }

    // ── verifying ─────────────────────────────────────────────────────────

    #[test]
    fn a_replacement_is_complete_only_at_this_build_and_able_to_activate() {
        for (registers_at, registers_in, expected) in [
            (THIS_BUILD, HelperStateName::Idle, Reconciled::AtThisBuild),
            (
                THIS_BUILD,
                HelperStateName::Activating,
                Reconciled::AtThisBuild,
            ),
            (
                THIS_BUILD,
                HelperStateName::Retiring,
                stopped(Stopped::VerifyWrongHelper {
                    state: HelperStateName::Retiring,
                    build_id: THIS_BUILD.to_string(),
                }),
            ),
            (
                THIS_BUILD,
                HelperStateName::Retired,
                stopped(Stopped::VerifyWrongHelper {
                    state: HelperStateName::Retired,
                    build_id: THIS_BUILD.to_string(),
                }),
            ),
            (
                OTHER_BUILD,
                HelperStateName::Idle,
                stopped(Stopped::VerifyWrongHelper {
                    state: HelperStateName::Idle,
                    build_id: OTHER_BUILD.to_string(),
                }),
            ),
        ] {
            let fake = Fake::new(World {
                preference: HelperPreference::Granted,
                registers_at: registers_at.to_string(),
                registers_in,
                ..World::default()
            });

            assert_eq!(
                reconciled(&fake),
                expected,
                "{registers_at} in {registers_in}"
            );
            // Registered once, verified once: a failed verification is repaired
            // by a later pass, never by a retry loop here.
            assert_eq!(fake.counted(&Event::Registered), 1);
            assert_eq!(fake.counted(&Event::StatusAsked), 1);
        }
    }

    #[test]
    fn a_registration_pending_approval_verifies_as_the_state_it_is() {
        let fake = Fake::new(World {
            preference: HelperPreference::Granted,
            registers_as: RegistrationStatus::RequiresApproval,
            ..World::default()
        });

        // The registering producer of the pending state: same state as the
        // table row above, reached by creating the registration this run.
        assert_eq!(reconciled(&fake), Reconciled::PendingApproval);
        assert_eq!(fake.counted(&Event::Registered), 1);
        // Nothing was asked of a socket nothing is listening on yet.
        assert_eq!(fake.counted(&Event::StatusAsked), 0);
    }

    #[test]
    fn a_silent_verification_window_is_judged_from_a_fresh_read() {
        // The listen window is macOS free to change its answer for as long as
        // it runs: the approval it wanted can be granted or demanded, and the
        // registration can go. Judging from the read that opened the window
        // would report a helper that never answered — a failure — for a
        // registration that is simply waiting on the user.
        for (after_the_window, expected) in [
            (
                RegistrationStatus::RequiresApproval,
                Reconciled::PendingApproval,
            ),
            (
                RegistrationStatus::NotRegistered,
                stopped(Stopped::VerifyFoundNoRegistration),
            ),
            (
                RegistrationStatus::NotFound,
                stopped(Stopped::ServiceDefinitionBroken),
            ),
            (
                RegistrationStatus::Enabled,
                stopped(Stopped::VerifyNeverAnswered),
            ),
        ] {
            let fake = Fake::new(World {
                preference: HelperPreference::Granted,
                // Registered `enabled` and nothing ever binds the socket. The
                // read after the window is the third: one to reach the
                // register, one to open the window, one to judge it.
                starts_answering_after: usize::MAX,
                status_changes_after_reads: Some((2, after_the_window)),
                ..World::default()
            });

            assert_eq!(
                reconciled(&fake),
                expected,
                "{after_the_window} after the window"
            );
            // One re-read, not a second window: the attempts are what they
            // would have been either way.
            assert_eq!(fake.counted(&Event::Registered), 1);
            assert_eq!(
                fake.counted(&Event::StatusAsked),
                VERIFY_LISTEN_ATTEMPTS as usize
            );
        }
    }

    #[test]
    fn a_fresh_helper_launchd_has_yet_to_spawn_still_verifies() {
        // The whole reason this window is longer than the one that proves an
        // absence: the helper is registered but launchd has not started it yet.
        // The delay is deliberately past the absence window's attempts — a
        // verification that reused those numbers would judge this helper missing
        // and report a failure on a fresh install that in fact worked.
        let waits = socket_probe::ABSENCE_ATTEMPTS as usize + 1;
        assert!(
            waits < VERIFY_LISTEN_ATTEMPTS as usize,
            "the delay is reachable"
        );
        let fake = Fake::new(World {
            preference: HelperPreference::Granted,
            starts_answering_after: waits,
            ..World::default()
        });

        assert_eq!(reconciled(&fake), Reconciled::AtThisBuild);
        assert_eq!(fake.counted(&Event::Waited(VERIFY_ATTEMPT_INTERVAL)), waits);
    }

    #[test]
    fn an_observation_that_cannot_be_made_authorizes_nothing() {
        // Fail closed on both reads. An unreadable stored decision must never
        // pass for "the user has not decided" — that would let an automatic path
        // adopt or remove a helper nobody ruled on — and an unreadable
        // registration leaves nothing to act on at all.
        let unreadable_registration = Fake::new(World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Granted,
            helper: Some(Helper::ready(OTHER_BUILD)),
            registration_unreadable: true,
            ..World::default()
        });

        assert!(matches!(
            reconciled(&unreadable_registration),
            Reconciled::Stopped(Stopped::RegistrationUnreadable(_))
        ));
        assert_eq!(unreadable_registration.mutations(), vec![]);

        let unreadable_decision = Fake::new(World {
            status: RegistrationStatus::Enabled,
            helper: Some(Helper::ready(OTHER_BUILD)),
            preference_unreadable: true,
            ..World::default()
        });

        assert!(matches!(
            reconciled(&unreadable_decision),
            Reconciled::Stopped(Stopped::PreferenceUnreadable(_))
        ));
        assert_eq!(unreadable_decision.mutations(), vec![]);
    }

    #[test]
    fn a_registration_that_vanishes_before_it_is_verified_is_a_failure() {
        let fake = Fake::new(World {
            preference: HelperPreference::Granted,
            // The register is dispatched and reported, and the registration is
            // gone by the time it is looked at.
            registers_as: RegistrationStatus::NotRegistered,
            ..World::default()
        });

        assert_eq!(
            reconciled(&fake),
            stopped(Stopped::VerifyFoundNoRegistration)
        );
        assert_eq!(fake.counted(&Event::Registered), 1);
    }

    #[test]
    fn a_registration_that_never_answers_is_reported_after_its_window() {
        let fake = Fake::new(World {
            preference: HelperPreference::Granted,
            // Registered, enabled, and nothing ever binds the socket.
            starts_answering_after: usize::MAX,
            ..World::default()
        });

        assert_eq!(reconciled(&fake), stopped(Stopped::VerifyNeverAnswered));
        assert_eq!(
            fake.counted(&Event::StatusAsked),
            VERIFY_LISTEN_ATTEMPTS as usize
        );
        assert_eq!(
            fake.counted(&Event::Waited(VERIFY_ATTEMPT_INTERVAL)),
            VERIFY_LISTEN_ATTEMPTS as usize - 1
        );
    }

    #[test]
    fn the_verification_window_outlasts_the_window_that_proves_an_absence() {
        // Confirming an absence only has to outlast a socket that is already
        // gone; a fresh registration still has to be spawned by launchd and
        // bind. Reusing the absence numbers would make every fresh install
        // report a failure it recovered from a moment later.
        assert!(VERIFY_LISTEN_WINDOW > socket_probe::POSITIVE_ABSENCE_WINDOW);
        assert_eq!(
            VERIFY_ATTEMPT_INTERVAL.saturating_mul(VERIFY_LISTEN_ATTEMPTS - 1),
            VERIFY_LISTEN_WINDOW
        );
    }

    // ── the gates ─────────────────────────────────────────────────────────

    #[test]
    fn a_copy_outside_the_applications_folder_mutates_nothing_and_writes_nothing() {
        let displaced = || World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Unset,
            helper: Some(Helper::ready(OTHER_BUILD)),
            install: InstallLocation::Elsewhere(Some(std::path::PathBuf::from(
                "/Volumes/nixmac/nixmac.app",
            ))),
            ..World::default()
        };
        let expected = Reconciled::Displaced(Displacement::NotInstalledInApplications(Some(
            std::path::PathBuf::from("/Volumes/nixmac/nixmac.app"),
        )));

        // Not even the decision that a Grant or a Disable would record: a copy
        // that may not touch a helper may not decide about one either.
        for outcome in [
            reconciled(&Fake::new(displaced())),
            decide(
                &LifecycleMutex::new(),
                &Fake::new(displaced()),
                HelperDecision::Granted,
            ),
            decide(
                &LifecycleMutex::new(),
                &Fake::new(displaced()),
                HelperDecision::Disabled,
            ),
        ] {
            assert_eq!(outcome, expected);
        }

        let fake = Fake::new(displaced());
        assert_eq!(reconciled(&fake), expected);
        assert_eq!(fake.mutations(), vec![]);
        assert_eq!(fake.counted(&Event::RetireSent), 0);
    }

    #[test]
    fn a_gui_whose_bundle_was_replaced_underneath_it_mutates_nothing() {
        let fake = Fake::new(World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Unset,
            helper: Some(Helper::ready(OTHER_BUILD)),
            stamped: Ok(OTHER_BUILD.to_string()),
            ..World::default()
        });

        assert_eq!(
            reconciled(&fake),
            Reconciled::Displaced(Displacement::BundleReplaced {
                running: THIS_BUILD.to_string(),
                on_disk: OTHER_BUILD.to_string(),
            })
        );
        assert_eq!(fake.mutations(), vec![]);
    }

    #[test]
    fn an_unreadable_bundle_stamp_stops_the_pass_rather_than_comparing_unequal() {
        // An unanswerable gate is answered no: a stamp flattened into an empty
        // string would compare unequal to this build forever and freeze every
        // decision behind it.
        let fake = Fake::new(World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Granted,
            helper: Some(Helper::ready(OTHER_BUILD)),
            stamped: Err("no stamp in the bundle".to_string()),
            ..World::default()
        });

        assert_eq!(
            reconciled(&fake),
            stopped(Stopped::BundleBuildIdUnreadable(
                "no stamp in the bundle".to_string()
            ))
        );
        assert_eq!(fake.mutations(), vec![]);
    }

    #[test]
    fn the_gates_are_re_evaluated_before_every_mutation_individually() {
        // Not once per pass: the bundle can be replaced by an update at any
        // point during one, and every mutation after that point would be a
        // previous build retiring helpers its own verification could never
        // accept. So the bundle is replaced after each successive gate reading
        // in turn, and each time the pass must stop with whatever it had
        // already done and nothing more.
        let world = || World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Unset,
            helper: Some(Helper::activating(OTHER_BUILD, 2)),
            ..World::default()
        };
        let whole = Fake::new(world());
        assert_eq!(reconciled(&whole), Reconciled::AtThisBuild);
        let gate_readings = whole.world().stamp_reads;
        let full = whole.mutations();
        // A pass with a drain, an adoption, an unregister and a register in it
        // passes the gate several times over.
        assert!(gate_readings > 1, "the gate ran {gate_readings} times");

        let mut previously_done = 0;
        for readings in 0..gate_readings {
            let fake = Fake::new(World {
                bundle_replaced_after_reads: Some(readings),
                ..world()
            });

            let outcome = reconciled(&fake);

            assert_eq!(
                outcome,
                Reconciled::Displaced(Displacement::BundleReplaced {
                    running: THIS_BUILD.to_string(),
                    on_disk: OTHER_BUILD.to_string(),
                }),
                "the bundle was replaced after {readings} gate readings"
            );
            let done = fake.mutations();
            assert!(
                full.starts_with(&done),
                "after {readings} gate readings the pass did {done:?}, which is not a prefix of {full:?}"
            );
            assert!(
                done.len() < full.len(),
                "after {readings} gate readings the pass did everything anyway"
            );
            // One more gate reading buys at most one more mutation. This is what
            // makes the gates *individual*: two mutations behind a single
            // reading would show up here as a cut that let both through.
            assert!(
                done.len() <= previously_done + 1,
                "one gate reading covered {} mutations at once",
                done.len() - previously_done
            );
            previously_done = done.len();
        }
        // The last reading has to be the one in front of the last mutation, or
        // that mutation sits past every gate and no cut could ever reach it.
        assert_eq!(
            previously_done,
            full.len() - 1,
            "cutting at the last gate reading left {previously_done} of {} mutations",
            full.len()
        );
    }

    #[test]
    fn every_mutation_is_immediately_preceded_by_a_gate_reading() {
        // The test above proves a failing gate stops the pass; this one proves
        // where the readings sit. The world is chosen so nothing can sit between
        // a reading and the mutation it guards — a pre-contract helper, so no
        // drain and no probe — which makes "immediately before" literal and
        // makes the count exact. Removing any of the four readings fails this
        // test, two of them by adjacency and two by the count: drop the reading
        // in front of the unregister or the register and the mutation is left
        // preceded by an exchange, while the pass-start and adoption readings
        // are adjacent to each other, so dropping either leaves the survivor in
        // the adjacent slot and only the count notices.
        let fake = Fake::new(World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Unset,
            helper: Some(Helper {
                peer: Peer::RootInvalid,
                ..Helper::ready("")
            }),
            ..World::default()
        });

        assert_eq!(reconciled(&fake), Reconciled::AtThisBuild);

        let events = fake.events();
        // Pass start, the decision it adopts, the unregister, the register.
        assert_eq!(
            fake.counted(&Event::GateRead),
            4,
            "gate readings changed: {events:?}"
        );
        let gated: Vec<bool> = events
            .iter()
            .enumerate()
            .filter(|(_, event)| is_mutation(event))
            .map(|(at, _)| at.checked_sub(1).and_then(|before| events.get(before)))
            .map(|before| before == Some(&Event::GateRead))
            .collect();

        assert_eq!(gated, vec![true, true, true], "in {events:?}");
    }

    #[test]
    fn a_removal_and_every_retire_send_are_gated_the_same_way() {
        // The two gated actions the world above cannot reach: a `Retire` send,
        // which is guarded because it changes what the helper will do next, and
        // a removal that unregisters with no replacement behind it. Same
        // literal adjacency — nothing between a reading and the action it
        // guards records an event on this path either.
        let fake = Fake::new(World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Disabled,
            helper: Some(Helper::activating(THIS_BUILD, 2)),
            ..World::default()
        });

        assert_eq!(reconciled(&fake), Reconciled::Removed);

        let events = fake.events();
        let gated: Vec<bool> = events
            .iter()
            .enumerate()
            .filter(|(_, event)| matches!(event, Event::RetireSent) || is_mutation(event))
            .map(|(at, _)| at.checked_sub(1).and_then(|before| events.get(before)))
            .map(|before| before == Some(&Event::GateRead))
            .collect();

        // Two sends refused with `Busy`, the third answered `Retired`, then the
        // unregister.
        assert_eq!(gated, vec![true, true, true, true], "in {events:?}");
    }

    // ── convergence ───────────────────────────────────────────────────────

    #[test]
    fn a_pass_cut_short_at_any_effect_converges_when_it_is_run_again() {
        // There is no recovery mode, because there is nothing to recover: a pass
        // that dies anywhere is simply run again, and the next one observes the
        // world as it now is. This kills each pass at every effect boundary in
        // turn — the full migration of a pre-contract helper, the longest
        // sequence there is — and requires the next pass to converge.
        let world = || World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Unset,
            helper: Some(Helper {
                peer: Peer::RootInvalid,
                ..Helper::activating("", 2)
            }),
            ..World::default()
        };
        let whole = Fake::new(world());
        assert_eq!(reconciled(&whole), Reconciled::AtThisBuild);
        let effects = whole.mutations().len();

        for budget in 0..effects {
            let fake = Fake::new(World {
                budget: Some(budget),
                ..world()
            });

            let cut_short = reconciled(&fake);
            assert_ne!(
                cut_short,
                Reconciled::AtThisBuild,
                "the pass was supposed to be cut short after {budget} effects"
            );
            assert_eq!(fake.mutations().len(), budget);

            // Nothing carries over but the world itself.
            fake.world().budget = None;
            assert_eq!(
                reconciled(&fake),
                Reconciled::AtThisBuild,
                "a pass cut short after {budget} effects did not converge"
            );
        }
    }

    #[test]
    fn an_unregister_that_fails_never_reaches_a_register() {
        // The old process may still be running, and registering a second helper
        // on top of one is what the whole sequence exists to avoid. The pass
        // ends and the slot is free for the next one.
        let lifecycle = LifecycleMutex::new();
        let fake = Fake::new(World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Granted,
            helper: Some(Helper::ready(OTHER_BUILD)),
            budget: Some(0),
            ..World::default()
        });

        assert!(matches!(
            run(&lifecycle, &fake, Trigger::Observation),
            Reconciled::Stopped(Stopped::UnregisterFailed(_))
        ));
        assert_eq!(fake.mutations(), vec![]);
        assert!(lifecycle.try_acquire(Trigger::Observation).is_some());
    }

    #[test]
    fn a_disable_cut_short_resumes_the_removal_rather_than_repairing_it() {
        // The decision is stored before the helper is touched, so a pass that
        // dies halfway through a removal leaves `disabled` behind — and the next
        // one finishes removing rather than putting the helper back.
        let fake = Fake::new(World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Granted,
            helper: Some(Helper::ready(THIS_BUILD)),
            // Enough for the decision, nothing for the removal.
            budget: Some(1),
            ..World::default()
        });

        assert!(matches!(
            decide(&LifecycleMutex::new(), &fake, HelperDecision::Disabled),
            Reconciled::Stopped(Stopped::UnregisterFailed(_))
        ));
        assert_eq!(
            fake.mutations(),
            vec![Event::StoredDecision(HelperDecision::Disabled)]
        );

        fake.world().budget = None;

        assert_eq!(reconciled(&fake), Reconciled::Removed);
        assert_eq!(
            fake.mutations(),
            vec![
                Event::StoredDecision(HelperDecision::Disabled),
                Event::Unregistered
            ]
        );
    }

    #[test]
    fn approval_that_arrives_weeks_later_converges_without_any_churn() {
        // Grant, no approval, relaunches, an app update, and then the user
        // finally approves in Login Items. Every pass in between reports the
        // pending state and mutates nothing; the approval itself lands on a
        // helper from the build that was current when it was granted, which is
        // the ordinary different-build case.
        let fake = Fake::new(World {
            registers_as: RegistrationStatus::RequiresApproval,
            ..World::default()
        });

        // The Grant registers; every pass after it finds the same state with
        // nothing left to create, which is what the mutation list below shows.
        assert_eq!(
            decide(&LifecycleMutex::new(), &fake, HelperDecision::Granted),
            Reconciled::PendingApproval
        );
        for _ in 0..3 {
            assert_eq!(reconciled(&fake), Reconciled::PendingApproval);
        }
        assert_eq!(
            fake.mutations(),
            vec![
                Event::StoredDecision(HelperDecision::Granted),
                Event::Registered
            ],
            "the pending state was registered over"
        );

        // Weeks later: approved, and by now the app has been updated, so what
        // was registered back then is a helper from the previous build.
        {
            let mut world = fake.world();
            world.status = RegistrationStatus::Enabled;
            world.helper = Some(Helper::ready(OTHER_BUILD));
            world.registers_as = RegistrationStatus::Enabled;
        }

        assert_eq!(reconciled(&fake), Reconciled::AtThisBuild);
        assert_eq!(reconciled(&fake), Reconciled::AtThisBuild);

        // Revoked in Login Items: reported as the pending state it is, with
        // nothing re-registered.
        {
            let mut world = fake.world();
            world.status = RegistrationStatus::RequiresApproval;
            world.helper = None;
        }
        let before = fake.mutations();

        assert_eq!(reconciled(&fake), Reconciled::PendingApproval);
        assert_eq!(fake.mutations(), before, "a revoked approval was churned");

        // Re-approved: the same convergence again, still without churn, because
        // what comes back is this build's helper.
        {
            let mut world = fake.world();
            world.status = RegistrationStatus::Enabled;
            world.helper = Some(Helper::ready(THIS_BUILD));
        }

        assert_eq!(reconciled(&fake), Reconciled::AtThisBuild);
        assert_eq!(fake.mutations(), before, "a re-approval was churned");
    }

    // ── one at a time ─────────────────────────────────────────────────────

    #[test]
    fn a_concurrent_caller_is_told_busy_and_its_decision_is_never_dropped() {
        // The slot is try-acquire: a second caller is answered immediately
        // rather than made to wait. A caller carrying a decision leaves a
        // re-run pending instead, and the pass holding the slot makes exactly
        // one more pass however many decisions landed while it ran — a later
        // pass reads the latest stored value, so one satisfies them all.
        let lifecycle = LifecycleMutex::new();
        let pause = PauseGate::new();
        let fake = Fake::paused_by(
            World {
                status: RegistrationStatus::Enabled,
                preference: HelperPreference::Granted,
                helper: Some(Helper::activating(OTHER_BUILD, 1)),
                ..World::default()
            },
            &pause,
        );

        std::thread::scope(|scope| {
            let holder = scope.spawn(|| run(&lifecycle, &fake, Trigger::Observation));

            // The pass is parked inside its `Retire` loop, holding the slot.
            pause.reached.wait();
            for _ in 0..3 {
                assert_eq!(
                    decide(&lifecycle, &fake, HelperDecision::Granted),
                    Reconciled::Busy
                );
            }
            assert_eq!(
                run(&lifecycle, &fake, Trigger::Observation),
                Reconciled::Busy,
                "an observation should not have to wait either"
            );
            pause.release.wait();

            assert_eq!(
                holder.join().expect("the holding pass"),
                Reconciled::AtThisBuild
            );
        });

        // Four callers turned away, three of them carrying a decision: one extra
        // pass, not three, and not none.
        assert_eq!(fake.refusals(), 4);
        assert_eq!(fake.passes(), 2, "one extra pass for the three decisions");
    }

    #[test]
    fn the_slot_is_released_however_a_pass_ends() {
        // Every exit path releases it, so a pass that stopped short never locks
        // the next one out.
        let lifecycle = LifecycleMutex::new();
        for world in [
            World {
                status: RegistrationStatus::NotFound,
                ..World::default()
            },
            World {
                status: RegistrationStatus::Enabled,
                preference: HelperPreference::Granted,
                helper: Some(Helper {
                    peer: Peer::Unjudgeable,
                    ..Helper::ready(THIS_BUILD)
                }),
                ..World::default()
            },
            World {
                install: InstallLocation::Elsewhere(None),
                ..World::default()
            },
        ] {
            let fake = Fake::new(world);

            assert!(matches!(
                run(&lifecycle, &fake, Trigger::Observation),
                Reconciled::Stopped(_) | Reconciled::Displaced(_)
            ));
            assert!(
                lifecycle.try_acquire(Trigger::Observation).is_some(),
                "the slot was still held after the pass ended"
            );
        }
    }

    #[test]
    fn a_panicking_pass_still_releases_the_slot() {
        // Nothing here panics on purpose, which is exactly why the release is a
        // `Drop` and not a step: a bug that unwinds must not leave the app
        // unable to reconcile until it is restarted.
        let lifecycle = LifecycleMutex::new();
        let panicking = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _slot = lifecycle
                .try_acquire(Trigger::Observation)
                .expect("the slot is free");
            panic!("a bug, somewhere in a pass");
        }));

        assert!(panicking.is_err());
        assert!(lifecycle.try_acquire(Trigger::Observation).is_some());
    }

    // ── the two decisions ─────────────────────────────────────────────────

    #[test]
    fn granting_and_disabling_record_the_decision_before_they_act_on_it() {
        // A crash between the two leaves the decision behind, so the next pass
        // finishes the job rather than undoing it. That is the whole reason the
        // stored value is written first.
        let granting = Fake::new(World::default());

        assert_eq!(
            decide(&LifecycleMutex::new(), &granting, HelperDecision::Granted),
            Reconciled::AtThisBuild
        );
        assert_eq!(
            granting.mutations(),
            vec![
                Event::StoredDecision(HelperDecision::Granted),
                Event::Registered
            ]
        );

        let disabling = Fake::new(World {
            status: RegistrationStatus::Enabled,
            preference: HelperPreference::Granted,
            helper: Some(Helper::ready(THIS_BUILD)),
            ..World::default()
        });

        assert_eq!(
            decide(&LifecycleMutex::new(), &disabling, HelperDecision::Disabled),
            Reconciled::Removed
        );
        assert_eq!(
            disabling.mutations(),
            vec![
                Event::StoredDecision(HelperDecision::Disabled),
                Event::Unregistered
            ]
        );
        // Retired first, then removed: a running helper is asked to stop taking
        // work before it is terminated.
        assert_eq!(disabling.counted(&Event::RetireSent), 1);
    }

    #[test]
    fn a_decision_that_cannot_be_stored_is_never_acted_on() {
        let fake = Fake::new(World {
            budget: Some(0),
            ..World::default()
        });

        assert!(matches!(
            decide(&LifecycleMutex::new(), &fake, HelperDecision::Granted),
            Reconciled::Stopped(Stopped::PreferenceUnwritable(_))
        ));
        assert_eq!(fake.mutations(), vec![]);
    }

    #[test]
    fn the_public_entry_points_carry_the_decision_they_are_named_for() {
        // The three functions the app actually calls. Everything else here
        // drives the inner ones against a private lifecycle mutex, so without
        // this a transposed decision or the wrong trigger in `grant`/`disable`
        // would ship green. The only test that touches the process-wide
        // instance; each call releases the slot before returning.
        let fake = Fake::new(World::default());

        assert_eq!(grant(&fake), Reconciled::AtThisBuild);
        assert_eq!(
            fake.mutations(),
            vec![
                Event::StoredDecision(HelperDecision::Granted),
                Event::Registered
            ]
        );

        assert_eq!(disable(&fake), Reconciled::Removed);
        assert_eq!(
            fake.mutations(),
            vec![
                Event::StoredDecision(HelperDecision::Granted),
                Event::Registered,
                Event::StoredDecision(HelperDecision::Disabled),
                Event::Unregistered,
            ]
        );

        // And the entry point that carries no decision decides nothing.
        assert_eq!(reconcile(&fake), Reconciled::NoHelper);
        assert_eq!(fake.mutations().len(), 4);
    }

    #[test]
    fn one_password_activation_finishing_does_not_clear_another_still_running() {
        // The record is a count, so overlapping activations cannot have the
        // first one to finish clear it under the second — which would let a
        // registration be dispatched underneath a running one.
        let lifecycle = LifecycleMutex::new();
        let first = lifecycle.start_password_activation().expect("the first");
        let second = lifecycle.start_password_activation().expect("the second");

        drop(first);

        assert!(
            lifecycle.enter(|section| section.password_activation_running()),
            "the second activation's record went with the first"
        );

        drop(second);

        assert!(!lifecycle.enter(|section| section.password_activation_running()));
    }

    #[test]
    fn every_pass_is_reported_including_the_one_nobody_is_waiting_on() {
        // The report is how a pass reaches the UI at all, and the extra pass a
        // run makes for a decision taken while it was busy has no caller left
        // to return to.
        let fake = Fake::new(World::default());

        assert_eq!(reconciled(&fake), Reconciled::NoHelper);

        assert_eq!(fake.world().reports, vec![Reconciled::NoHelper]);
    }
}
