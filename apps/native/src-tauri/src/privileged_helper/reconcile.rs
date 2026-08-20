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
//   gate → resolve the stored decision → the status × decision table →
//   classify the peer → unregister → register → verify
//
// No cooperation is needed from the old helper beyond one `Status`
// answer: activations run in a detached runner that survives
// `SMAppService` unregister (see `helper_runtime`), so terminating a helper
// interrupts nothing. When the old helper reports a running activation, the
// pass simply ends with [`Reconciled::WaitingOnActivation`] — the convergence
// loop re-observes on its waiting cadence, and the next pass that finds the
// helper idle replaces it. A truly hung activation therefore keeps the
// report on screen for as long as the app runs; nothing here force-kills
// anything.
//
// One type rather than discipline carries the safety of the register step:
// `Committed` is demanded by every register and minted in exactly one place —
// the register step's immediately-before checks. Nothing outside this module
// can construct one, so a register reached from anywhere else has nothing to
// pass.
//
// Nothing here can open System Settings: that capability is absent from the
// seam, which is how startup and refresh are kept from doing it.

use crate::build_id;
use crate::privileged_helper::client::{
    self, AssessedExchange, HelperClientError, ListenerObservation,
};
use crate::privileged_helper::protocol::{self, ActivationInfo, HelperReply, HelperStateName};
use crate::privileged_helper::service::{
    self, RegisterFailure, RegistrationStatus, ReplaceFailure,
};
use crate::shared_types::{HelperDecision, HelperPreference};
use crate::state::preferences;
use crate::system::install_location::{self, InstallLocation};
use std::fmt::Display;
use std::sync::{Mutex, PoisonError, TryLockError};
use std::time::Duration;
use tauri::{AppHandle, Runtime};

/// Bound on one ServiceManagement call reporting back. The unregister's
/// completion is the signal that the old process was killed, and re-register
/// is safe after it — but exactly-once delivery is a promise of the API, not
/// of the universe, so a run is never held open on silence. Expiry ends the
/// run, which loses nothing: a later pass converges from what it observes.
const SERVICE_CALL_WINDOW: Duration = Duration::from_secs(30);

/// The window a fresh registration gets to start answering before it is
/// judged missing: launchd still has to spawn the helper and let it bind its
/// socket. Deliberately longer than the absence window the client uses to
/// prove a socket dead (~2 × its ~7.5 s) — reuse the absence numbers here and
/// every fresh install reports a verification failure it recovered from a
/// moment later.
const VERIFY_ATTEMPT_INTERVAL: Duration = Duration::from_millis(2_500);
const VERIFY_LISTEN_ATTEMPTS: u32 = 7;

// ---------------------------------------------------------------------------
// What a run reports.
// ---------------------------------------------------------------------------

/// What one run of the function found and did.
///
/// Total: every path out of a run is one of these, so the UI decides by
/// matching. Nothing here is progress or state — a report describes the world
/// at the moment the run ended, and the next run derives its own.
///
/// The two text-carrying variants hold the finished sentence the permissions
/// UI shows, written at the site that read the failure. This app already puts
/// helper detail text this way (`system::permissions` composes the same kind of
/// string and the panel renders it verbatim); `system::helper_permission` is
/// what turns a report into the row's detail. No decision anywhere reads that
/// text — what a caller acts on is the variant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reconciled {
    /// A registration exists and an authenticated `Status` reported this
    /// build's ID. The goal is met; the normal outcome of almost every
    /// startup.
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
    /// A run was already in flight, so this observation did nothing at all.
    /// Only observations report it: a Grant or Disable waits the in-flight
    /// pass out instead ([`decide`]), so a decision is never dropped against
    /// a busy slot.
    Busy,
    /// The installed helper (of whatever build) reported a running
    /// activation, so this pass mutated nothing and ended. Not a failure:
    /// the convergence loop re-observes on its waiting cadence — activations
    /// take minutes and are never interrupted — and the pass that finds the
    /// helper idle carries on. `activation` is display-only and absent when
    /// the reporting helper never knew X (it was relaunched over the
    /// running activation).
    WaitingOnActivation(Option<ActivationInfo>),
    /// Final: this copy of nixmac may not mutate a helper — it does not run
    /// from `/Applications`, or its bundle was replaced underneath it. Nothing
    /// was unregistered, registered, or written, and no later run changes the
    /// answer: the user has to move the app or restart it.
    Displaced(String),
    /// Final: `notFound` — the bundle's own service definition is broken, so
    /// there is nothing to register and nothing to remove. A property of the
    /// bundle, read identically every time.
    ServiceDefinitionBroken,
    /// Retryable: the run stopped short. Nothing further was mutated; a later
    /// run converges from what it observes then.
    Stopped(String),
}

// The sentences a stopped run shows, written once each and next to nothing
// else. Every one of them is a clause without a full stop — `helper_permission`
// terminates it.

fn preference_unreadable(detail: impl Display) -> Reconciled {
    Reconciled::Stopped(format!(
        "the stored helper decision could not be read: {detail}"
    ))
}

fn preference_unwritable(detail: impl Display) -> Reconciled {
    Reconciled::Stopped(format!("the helper decision could not be stored: {detail}"))
}

fn peer_unidentified(detail: impl Display) -> Reconciled {
    Reconciled::Stopped(format!(
        "the helper socket is held by something unidentified: {detail}"
    ))
}

fn socket_unusable(detail: impl Display) -> Reconciled {
    Reconciled::Stopped(format!("the helper socket is unusable: {detail}"))
}

fn unregister_failed(detail: impl Display) -> Reconciled {
    Reconciled::Stopped(format!("the helper could not be unregistered: {detail}"))
}

fn register_failed(detail: impl Display) -> Reconciled {
    Reconciled::Stopped(format!("the helper could not be registered: {detail}"))
}

/// A step's outcome. `Ok` is a pass that reached a resting state, `Err` one
/// that ended before the step it was heading for — a stop, a displacement, or
/// (in the one case of an undecided user with nothing to adopt) a resting state
/// reached early. Both channels are terminal and both are reported the same
/// way; the split is what lets `?` end a pass from anywhere without a
/// control-flow enum.
type Step = Result<Reconciled, Reconciled>;

// ---------------------------------------------------------------------------
// The single-flight slot.
// ---------------------------------------------------------------------------

/// One run at a time, process-wide. An observation that finds it taken is
/// told [`Reconciled::Busy`] rather than made to wait; a decision *waits* and
/// then makes its own pass.
///
/// The split is what keeps a decision from being dropped: the convergence
/// loop only re-runs while it has something left to do, so a Disable stored
/// while the loop's final pass was mid-flight would otherwise never be read —
/// the loop ends on the stale resting state and nothing re-runs until the
/// next refresh. Blocking the decision instead is affordable now that every
/// pass is bounded (the longest waits are the verify listen window and the
/// two service-call windows); there is no unbounded step left for a click to
/// hang on.
///
/// The guard's `Drop` releases the slot on every path out of a run, a panic
/// included.
static RUNNING: Mutex<()> = Mutex::new(());

// ---------------------------------------------------------------------------
// Evidence: what the register step is handed rather than asserting.
// ---------------------------------------------------------------------------

/// The register step's immediately-before checks passed. Demanded by every
/// register, and minted in exactly one place — [`commit_to_register`] — so a
/// registration that skipped the gates and the fresh preference read cannot be
/// expressed.
mod evidence {
    pub struct Committed(());

    impl Committed {
        pub(super) fn checked() -> Self {
            Self(())
        }
    }
}

// `Committed` is nameable outside this module because the environment methods
// that demand one are; minting one is not — `Committed::checked` stays visible
// only in here, so the register step remains the only place one comes from.
pub use evidence::Committed;

// ---------------------------------------------------------------------------
// The seam.
// ---------------------------------------------------------------------------

/// One exchange with whatever answers the helper socket.
///
/// The peer assessment is kept apart rather than flattened: what may be done
/// about a helper that cannot be talked to depends entirely on whether
/// validation said "no" or said nothing.
pub enum PeerReply {
    /// Root, validated, and it answered.
    Answered(HelperReply),
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
/// Only observations and effects live here, and no method decides anything
/// about the goal or the helper. Nothing this function does asks for System
/// Settings either — the capability is simply not in the seam, so a run that no
/// click is waiting on (startup, a status refresh) opens nothing, whatever it
/// observes.
pub trait Environment {
    /// The build ID compiled into this process.
    fn compiled_build_id(&self) -> &str;

    /// Whether this copy of nixmac may mutate a helper at all: it runs from
    /// `/Applications`, and its bundle on disk is still the build it was
    /// compiled as. An `Err` is the report the run ends with.
    fn gate(&self) -> Result<(), Reconciled>;

    /// What `SMAppService` reports about nixmac's helper registration.
    fn registration_status(&self) -> Result<RegistrationStatus, String>;

    /// The stored decision about the helper.
    fn preference(&self) -> Result<HelperPreference, String>;

    /// Stores a decision. There is deliberately no way to store "undecided".
    fn store_decision(&self, decision: HelperDecision) -> Result<(), String>;

    /// Whether anything is listening on the helper socket, over the absence
    /// window. Pure observation: no protocol bytes are written, which is
    /// what makes it safe to point at a helper of any build.
    fn observe_listener(&self) -> ListenerObservation;

    /// Sends `Status` on a fresh connection.
    fn status_exchange(&self) -> PeerReply;

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

    /// Waits. Injected so the bounded verify window costs tests nothing.
    fn wait(&self, interval: Duration);
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
    fn compiled_build_id(&self) -> &str {
        protocol::BUILD_ID
    }

    fn gate(&self) -> Result<(), Reconciled> {
        gates_live()
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
        client::observe_listener()
    }

    fn status_exchange(&self) -> PeerReply {
        match client::assessed_status() {
            Ok(AssessedExchange::Answered(reply)) => PeerReply::Answered(reply),
            Ok(AssessedExchange::RootUnverifiable(detail)) => PeerReply::RootUnverifiable(detail),
            Ok(AssessedExchange::Unidentified(detail)) => PeerReply::Unidentified(detail),
            Err(error) => PeerReply::Failed(error),
        }
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
}

// ---------------------------------------------------------------------------
// The gates.
// ---------------------------------------------------------------------------

/// The two gates in front of every mutation and every write, over the live
/// facts.
///
/// Public for one reason: Apply asks the same question before deciding whether
/// it may touch a helper, and a second implementation of it could disagree with
/// this one.
pub fn gates_live() -> Result<(), Reconciled> {
    let location = install_location::locate_app_bundle();
    let on_disk = match &location {
        InstallLocation::Canonical(bundle) => build_id::read_bundle_build_id(bundle),
        // The install gate ends any run that reaches this, and a bundle that
        // moved mid-run has no stamp worth comparing.
        InstallLocation::Elsewhere(_) => {
            Err("nixmac is not installed in /Applications".to_string())
        }
    };
    judge_gates(&location, protocol::BUILD_ID, on_disk)
}

/// The gate judgment itself, over the three facts it is about.
///
/// Re-evaluated before each mutation and each write rather than once per pass:
/// two of these facts can change while a pass runs — an app can be moved, and a
/// bundle can be replaced by an update — and what they guard is destructive.
fn judge_gates(
    location: &InstallLocation,
    compiled: &str,
    on_disk: Result<String, String>,
) -> Result<(), Reconciled> {
    // Canonical install. A copy running from anywhere else observes and
    // reports only.
    if let InstallLocation::Elsewhere(observed) = location {
        return Err(Reconciled::Displaced(match observed {
            Some(path) => format!(
                "nixmac runs from {} — move it to /Applications",
                path.display()
            ),
            None => "nixmac is not running from an app bundle in /Applications".to_string(),
        }));
    }
    // Stale GUI. A bundle replaced underneath this process means the helper it
    // would register is not the one it is compiled to talk to, so it would be
    // replacing helpers its own verification could never accept.
    let on_disk = on_disk.map_err(|detail| {
        Reconciled::Stopped(format!(
            "this app's installed build could not be read: {detail}"
        ))
    })?;
    if on_disk != compiled {
        return Err(Reconciled::Displaced(format!(
            "this app was replaced while running (build {compiled} is running, {on_disk} is installed) — restart nixmac"
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Entry points.
// ---------------------------------------------------------------------------

/// Reconciles the installed helper with this build. Idempotent, and its normal
/// path is a single `Status` exchange, so running it at startup and on every
/// status refresh is cheap.
pub fn reconcile<E: Environment>(env: &E) -> Reconciled {
    run(&RUNNING, env)
}

/// The explicit Grant action: record the decision, then reconcile under it.
/// First-time registration and repairing a half-finished one are the same
/// step, and the write is idempotent.
///
/// Opening Login Items is the caller's action, never this function's.
pub fn grant<E: Environment>(env: &E) -> Reconciled {
    decide(&RUNNING, env, HelperDecision::Granted)
}

/// The explicit Disable action: record the decision, then reconcile under it.
/// The decision is written first, so a crash halfway resumes the removal
/// rather than repairing the helper.
pub fn disable<E: Environment>(env: &E) -> Reconciled {
    decide(&RUNNING, env, HelperDecision::Disabled)
}

/// Stores a decision and reconciles under it. The slot is a parameter so tests
/// get one of their own rather than the process-wide static.
///
/// Unlike an observation, a decision never takes `Busy` for an answer: it
/// waits out an in-flight pass (bounded — see [`RUNNING`]) and then makes its
/// own, so the pass that carries the decision out always exists and its
/// report is what the click's caller renders.
fn decide<E: Environment>(running: &Mutex<()>, env: &E, decision: HelperDecision) -> Reconciled {
    // A copy that may not mutate a helper may not record a decision about one
    // either — the gates cover the write, not just the effects.
    if let Err(report) = env.gate() {
        return reported(report);
    }
    if let Err(detail) = env.store_decision(decision) {
        return reported(preference_unwritable(detail));
    }
    // Nothing this slot guards is half-applied by a panic — it guards no
    // data — so a poisoned lock is taken rather than propagated.
    let _slot = running.lock().unwrap_or_else(PoisonError::into_inner);
    reported(converge(env).unwrap_or_else(|report| report))
}

fn run<E: Environment>(running: &Mutex<()>, env: &E) -> Reconciled {
    let _slot = match running.try_lock() {
        Ok(slot) => slot,
        // Poison handled as in [`decide`].
        Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
        // Immediate, never a wait: observations are cheap to repeat and the
        // convergence loop repeats them on its own cadence.
        Err(TryLockError::WouldBlock) => return reported(Reconciled::Busy),
    };
    reported(converge(env).unwrap_or_else(|report| report))
}

/// Logs one run's outcome and hands it back.
fn reported(outcome: Reconciled) -> Reconciled {
    log::info!("helper reconciliation: {outcome:?}");
    outcome
}

/// What the stored decision asks for. The third stored value, "undecided", is
/// not a goal — it is resolved into one of these, or the pass ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Goal {
    Install,
    Remove,
}

fn converge<E: Environment>(env: &E) -> Step {
    env.gate()?;
    let status = status(env)?;
    let goal = goal(env, status)?;
    match (status, goal) {
        (RegistrationStatus::NotRegistered, Goal::Install) => register_fresh(env),
        (RegistrationStatus::NotRegistered, Goal::Remove) => Ok(Reconciled::NoHelper),
        // Approval is a state, not an error: reported, never re-registered,
        // and never a reason to open System Settings. This arm registers
        // nothing, however often it is reached.
        (RegistrationStatus::RequiresApproval, Goal::Install) => Ok(Reconciled::PendingApproval),
        // An approval-pending service has no process, so there is nothing
        // to observe before removing it.
        (RegistrationStatus::RequiresApproval, Goal::Remove) => remove(env),
        (RegistrationStatus::Enabled, goal) => classify(env, goal),
        // Nothing to register and nothing to remove: the definition this
        // would act on is not there.
        (RegistrationStatus::NotFound, _) => Err(Reconciled::ServiceDefinitionBroken),
    }
}

fn status<E: Environment>(env: &E) -> Result<RegistrationStatus, Reconciled> {
    env.registration_status().map_err(|detail| {
        Reconciled::Stopped(format!(
            "the helper registration could not be read: {detail}"
        ))
    })
}

/// Resolves the stored decision into a goal, adopting an existing registration
/// as the user's earlier opt-in.
///
/// The resolution is a write, so the stale-GUI gate applies to it: a GUI whose
/// bundle was replaced underneath it records nothing.
fn goal<E: Environment>(env: &E, status: RegistrationStatus) -> Result<Goal, Reconciled> {
    let preference = env.preference().map_err(preference_unreadable)?;
    match preference {
        HelperPreference::Granted => Ok(Goal::Install),
        HelperPreference::Disabled => Ok(Goal::Remove),
        HelperPreference::Unset => match status {
            // A registration that already exists is the user's earlier
            // opt-in — including the pre-contract one, which is what makes
            // the migration automatic. Recorded before anything is
            // mutated, so a crash cannot lose it.
            RegistrationStatus::RequiresApproval | RegistrationStatus::Enabled => {
                env.gate()?;
                env.store_decision(HelperDecision::Granted)
                    .map_err(preference_unwritable)?;
                Ok(Goal::Install)
            }
            // Nothing to adopt. A first registration needs the explicit
            // Grant action, never an automatic path.
            RegistrationStatus::NotRegistered => Err(Reconciled::NoHelper),
            // Never resolves the decision; reported as the failure it is.
            RegistrationStatus::NotFound => Err(Reconciled::ServiceDefinitionBroken),
        },
    }
}

/// What is answering the socket of an `enabled` registration. Exactly one of
/// four things, and only an authenticated peer is ever spoken to.
fn classify<E: Environment>(env: &E, goal: Goal) -> Step {
    match env.status_exchange() {
        PeerReply::Answered(reply) => decide_from_status(env, goal, reply),
        // The pre-contract helper, or a tampered one: removed without
        // being asked anything, because no reply from it could be
        // trusted. Only a *completed* "no" reaches this arm — a
        // validation that got no answer is `Unidentified` below and
        // authorizes nothing. This is also the one removal that can
        // interrupt an in-process activation (the legacy helper is its
        // own executor), the accepted one-time migration risk.
        PeerReply::RootUnverifiable(detail) => {
            // The only record of the judgment: no report this arm can end
            // in carries the detail, and an incident log that cannot say
            // why the peer was rejected cannot be reconstructed.
            log::info!("helper peer unverifiable: {detail}");
            remove_or_replace(env, goal)
        }
        PeerReply::Unidentified(detail) => Err(peer_unidentified(detail)),
        // Nothing answered. Whether that is a real absence — as opposed
        // to a helper mid-crash-relaunch or mid-startup — takes the
        // absence window to establish; the cost of a wrong "absent" is
        // registration churn, never an interrupted activation.
        PeerReply::Failed(HelperClientError::Unreachable(error)) => {
            decide_from_absence(env, goal, error.to_string())
        }
        PeerReply::Failed(error) => Err(exchange_failed(error)),
    }
}

fn decide_from_status<E: Environment>(env: &E, goal: Goal, reply: HelperReply) -> Step {
    let HelperReply::Status {
        state,
        helper_build_id,
        activation,
    } = &reply
    else {
        // A helper of any build answers `Status` with a state. Anything
        // else is a refusal, and refusals are never acted on.
        return Err(helper_refused(&reply));
    };
    // The one place the discovered state is visible: several reports
    // (`AtThisBuild` in particular) do not carry it, and an incident log
    // that cannot say what the helper answered cannot be reconstructed.
    log::info!(
        "helper status: {state} at build {helper_build_id}{}",
        match activation {
            Some(info) => format!(
                " ({} submitted by the {})",
                info.script_path, info.client_kind
            ),
            None => String::new(),
        }
    );
    // Byte equality, and nothing else: an empty peer build ID is a
    // perfectly legitimate reply that simply is not this build's, so it
    // takes the different-build path rather than being rejected.
    if helper_build_id == env.compiled_build_id() && goal == Goal::Install {
        // This build's helper, wanted — running an activation or not,
        // there is nothing to change.
        return Ok(Reconciled::AtThisBuild);
    }
    // A helper that has to go — the wrong build, or a removal — is never
    // touched while it reports a running activation: unregister would
    // orphan the runner harmlessly, but the pass defers anyway so the
    // running apply keeps its result reply and the report tells the user
    // what everything is waiting for. The convergence loop re-observes.
    if matches!(state, HelperStateName::Activating) {
        return Ok(Reconciled::WaitingOnActivation(activation.clone()));
    }
    remove_or_replace(env, goal)
}

/// Establishes whether an unreachable socket means no listener at all.
///
/// Total over the three verdicts: only the proved absence proceeds to a
/// mutation, and everything else — something answering, or nothing
/// established — leaves the registration alone for a later pass.
fn decide_from_absence<E: Environment>(env: &E, goal: Goal, connect_error: String) -> Step {
    match env.observe_listener() {
        ListenerObservation::PositivelyAbsent => remove_or_replace(env, goal),
        ListenerObservation::Listening => Err(socket_unusable(format!(
            "{connect_error}; something is listening on it but did not answer"
        ))),
        ListenerObservation::Ambiguous(detail) => {
            Err(socket_unusable(format!("{connect_error}; {detail}")))
        }
    }
}

/// Removes the registration, then registers this build's helper if that is the
/// goal. The gates are re-checked immediately before the mutation: both facts
/// they observe can change while a pass runs.
fn remove_or_replace<E: Environment>(env: &E, goal: Goal) -> Step {
    env.gate()?;
    match goal {
        Goal::Install => replace(env),
        // A recorded Disable is never overridden by an automatic path, the
        // one-time migration of a pre-contract helper included.
        Goal::Remove => remove(env),
    }
}

fn remove<E: Environment>(env: &E) -> Step {
    env.gate()?;
    env.unregister().map_err(unregister_failed)?;
    Ok(Reconciled::Removed)
}

fn replace<E: Environment>(env: &E) -> Step {
    match env.replace_helper(&|| commit_to_register(env)) {
        Ok(()) => verify(env),
        Err(failure) => Err(match failure {
            // The register step's own report, whatever it was: this pass
            // unregistered the old helper and deliberately registered
            // nothing in its place.
            ReplaceFailure::RegisterDeclined(report) => report,
            ReplaceFailure::UnregisterFailed(error) => unregister_failed(error),
            ReplaceFailure::UnregisterSilent => unregister_failed("the unregister never reported"),
            ReplaceFailure::RegisterFailed(error) => register_failed(error),
            ReplaceFailure::RegisterSilent => register_failed("the register never reported"),
            // Refused before anything was dispatched, so nothing changed.
            ReplaceFailure::CalledOnMainThread => {
                register_failed("a helper replacement cannot run on the main thread")
            }
        }),
    }
}

fn register_fresh<E: Environment>(env: &E) -> Step {
    // The gates are inside the commitment, which is where every register's
    // immediately-before checks live.
    let committed = commit_to_register(env)?;
    env.register(committed).map_err(|failure| match failure {
        RegisterFailure::Failed(error) => register_failed(error),
        RegisterFailure::Silent => register_failed("the register never reported"),
        RegisterFailure::CalledOnMainThread => {
            register_failed("a registration cannot run on the main thread")
        }
    })?;
    verify(env)
}

/// The register step's immediately-before checks, and the only mint of the
/// token every register demands.
///
/// A Disable clicked while a replacement was under way must not be followed by
/// a fresh registration and its Login Items prompt, so the stored decision is
/// re-read here, at the last moment a registration can still be declined. This
/// is the one place a decision made mid-pass takes effect in that pass, and it
/// can only ever stop a registration.
///
/// The window between this read and the register itself is not zero, and needs
/// no closing: a decision is written before its own pass ([`decide`]), and that
/// pass — blocked on [`RUNNING`] until this one ends — carries the decision out
/// against whatever this pass did. A write that lands after this read costs at
/// most one registration that the very next pass removes; it is never lost.
fn commit_to_register<E: Environment>(env: &E) -> Result<Committed, Reconciled> {
    // A register is a mutation like any other.
    env.gate()?;
    match env.preference() {
        Ok(HelperPreference::Granted) => Ok(evidence::Committed::checked()),
        Ok(HelperPreference::Disabled | HelperPreference::Unset) => Err(Reconciled::Stopped(
            "the helper is no longer granted; it was being replaced".to_string(),
        )),
        Err(detail) => Err(preference_unreadable(detail)),
    }
}

/// Every registration this pass dispatches is verified.
fn verify<E: Environment>(env: &E) -> Step {
    match status(env)? {
        RegistrationStatus::Enabled => verify_listening(env),
        settled => verify_from_status(settled),
    }
}

/// Judges a dispatched registration from a status read alone.
///
/// Both status reads a verification can make land here: the one above, whose
/// `enabled` goes to the listen window rather than to a verdict, and the fresh
/// one taken when that window expires. So the `enabled` arm belongs to the
/// second read alone — nothing answered, and the registration still says
/// something should have.
fn verify_from_status(status: RegistrationStatus) -> Step {
    match status {
        // Registered, and macOS wants the user's approval. Normal.
        RegistrationStatus::RequiresApproval => Ok(Reconciled::PendingApproval),
        RegistrationStatus::NotRegistered => Err(Reconciled::Stopped(
            "the helper registration disappeared while it was being verified".to_string(),
        )),
        RegistrationStatus::NotFound => Err(Reconciled::ServiceDefinitionBroken),
        RegistrationStatus::Enabled => Err(Reconciled::Stopped(
            "the registered helper never answered on its socket".to_string(),
        )),
    }
}

/// Waits out the listen window for the fresh helper to answer, then judges what
/// answered. Never a retry loop around a verdict: only a socket that is not
/// there yet is worth another attempt.
fn verify_listening<E: Environment>(env: &E) -> Step {
    for attempt in 0..VERIFY_LISTEN_ATTEMPTS {
        if attempt > 0 {
            env.wait(VERIFY_ATTEMPT_INTERVAL);
        }
        match env.status_exchange() {
            PeerReply::Answered(reply) => return judge(env, reply),
            // launchd still has to spawn the helper and let it bind. The
            // one outcome this window exists for.
            PeerReply::Failed(HelperClientError::Unreachable(_)) => continue,
            PeerReply::RootUnverifiable(detail) | PeerReply::Unidentified(detail) => {
                return Err(peer_unidentified(detail));
            }
            PeerReply::Failed(error) => return Err(exchange_failed(error)),
        }
    }
    // Silence is judged from a fresh read, never from the one that opened
    // the window: a registration can require approval, or be gone, by the
    // time the window ends, and either would be reported as a helper that
    // never answered — a failure — for a state that is not one. The window
    // is the only thing between the two reads, and it is long enough for
    // macOS to have changed its answer inside it.
    verify_from_status(status(env)?)
}

fn judge<E: Environment>(env: &E, reply: HelperReply) -> Step {
    match &reply {
        HelperReply::Status {
            helper_build_id, ..
        } => {
            // The allowlist: this build's ID, byte for byte. Either state
            // is fine — a fresh helper can already be running a sync
            // agent's activation.
            if helper_build_id == env.compiled_build_id() {
                Ok(Reconciled::AtThisBuild)
            } else {
                Err(Reconciled::Stopped(format!(
                    "the registered helper reports build {helper_build_id}, not this build"
                )))
            }
        }
        _ => Err(helper_refused(&reply)),
    }
}

/// An authenticated helper answered something a step cannot act on.
fn helper_refused(reply: &HelperReply) -> Reconciled {
    Reconciled::Stopped(format!("the helper refused: {}", reply.summary()))
}

/// Reads one failed exchange into a report.
fn exchange_failed(error: HelperClientError) -> Reconciled {
    match error {
        HelperClientError::Unreachable(error) => socket_unusable(error),
        // A close before a reply is a live helper declining this client or a
        // connection over the cap — stop and re-observe, never a conclusion.
        HelperClientError::ClosedBeforeReply => {
            socket_unusable("the helper closed the connection before replying")
        }
        HelperClientError::AuthenticationFailed(error) => peer_unidentified(format!("{error:#}")),
        HelperClientError::Io(error) => socket_unusable(error),
        HelperClientError::UnparseableReply(detail) => Reconciled::Stopped(format!(
            "the helper sent a reply this build cannot parse: {detail}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::privileged_helper::peer_auth::ClientKind;
    use std::cell::RefCell;
    use std::path::PathBuf;

    const THIS_BUILD: &str = "build-current";
    const OTHER_BUILD: &str = "build-previous";
    const SCRIPT: &str = "/nix/store/abc-darwin-system/activate";

    fn activation(kind: ClientKind) -> ActivationInfo {
        ActivationInfo {
            request_id: "req-1".to_string(),
            script_path: SCRIPT.to_string(),
            client_kind: kind,
        }
    }

    fn status_reply(
        build: &str,
        state: HelperStateName,
        activation: Option<ActivationInfo>,
    ) -> HelperReply {
        HelperReply::Status {
            state,
            helper_build_id: build.to_string(),
            activation,
        }
    }

    /// What one scripted status exchange answers, cloneable for scripting.
    #[derive(Clone)]
    enum Peer {
        Answered(HelperReply),
        RootUnverifiable,
        Unidentified,
        Unreachable,
        ClosedBeforeReply,
        Unparseable,
    }

    impl Peer {
        fn reply(&self) -> PeerReply {
            match self {
                Peer::Answered(reply) => PeerReply::Answered(reply.clone()),
                Peer::RootUnverifiable => {
                    PeerReply::RootUnverifiable("ad-hoc signature".to_string())
                }
                Peer::Unidentified => PeerReply::Unidentified("no judgment".to_string()),
                Peer::Unreachable => PeerReply::Failed(HelperClientError::Unreachable(
                    std::io::Error::from(std::io::ErrorKind::ConnectionRefused),
                )),
                Peer::ClosedBeforeReply => PeerReply::Failed(HelperClientError::ClosedBeforeReply),
                Peer::Unparseable => {
                    PeerReply::Failed(HelperClientError::UnparseableReply("not json".to_string()))
                }
            }
        }
    }

    /// Everything one pass may do, recorded.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum Act {
        StoredGranted,
        StoredDisabled,
        ObservedListener,
        Unregistered,
        Replaced,
        Registered,
    }

    /// A scripted world. `exchanges` is consumed front to back — one entry per
    /// status exchange the pass makes (classification first, then each verify
    /// attempt).
    struct World {
        compiled: &'static str,
        /// One entry per gate the pass reaches, front to back; the last one
        /// answers every gate after it. Scripting them apart is what pins
        /// *which* gate a refusal stopped.
        gates: RefCell<Vec<Result<(), Reconciled>>>,
        status: RefCell<Vec<Result<RegistrationStatus, String>>>,
        preference: RefCell<Result<HelperPreference, String>>,
        exchanges: RefCell<Vec<Peer>>,
        listener: ListenerObservation,
        unregister: Result<(), String>,
        replace: RefCell<Option<ReplaceFailure<Reconciled>>>,
        register: RefCell<Option<RegisterFailure>>,
        /// The user disables while the old helper is being killed, which is
        /// exactly when the commitment re-reads the stored decision.
        disable_during_replace: bool,
        acts: RefCell<Vec<Act>>,
    }

    impl Default for World {
        fn default() -> Self {
            Self {
                compiled: THIS_BUILD,
                gates: RefCell::new(vec![Ok(())]),
                status: RefCell::new(vec![Ok(RegistrationStatus::Enabled)]),
                preference: RefCell::new(Ok(HelperPreference::Granted)),
                exchanges: RefCell::new(Vec::new()),
                listener: ListenerObservation::PositivelyAbsent,
                unregister: Ok(()),
                replace: RefCell::new(None),
                register: RefCell::new(None),
                disable_during_replace: false,
                acts: RefCell::new(Vec::new()),
            }
        }
    }

    impl World {
        /// Registered, granted, and the helper answers `first` on the first
        /// exchange.
        fn answering(first: HelperReply) -> Self {
            Self {
                exchanges: RefCell::new(vec![Peer::Answered(first)]),
                ..Self::default()
            }
        }

        fn with_gates(mut self, gates: Vec<Result<(), Reconciled>>) -> Self {
            self.gates = RefCell::new(gates);
            self
        }

        fn with_statuses(mut self, statuses: Vec<Result<RegistrationStatus, String>>) -> Self {
            self.status = RefCell::new(statuses);
            self
        }

        fn with_exchanges(mut self, exchanges: Vec<Peer>) -> Self {
            self.exchanges = RefCell::new(exchanges);
            self
        }

        fn acts(&self) -> Vec<Act> {
            self.acts.borrow().clone()
        }

        fn did(&self, act: Act) {
            self.acts.borrow_mut().push(act);
        }
    }

    impl Environment for World {
        fn compiled_build_id(&self) -> &str {
            self.compiled
        }

        fn gate(&self) -> Result<(), Reconciled> {
            let mut gates = self.gates.borrow_mut();
            if gates.len() > 1 {
                gates.remove(0)
            } else {
                gates[0].clone()
            }
        }

        fn registration_status(&self) -> Result<RegistrationStatus, String> {
            let mut statuses = self.status.borrow_mut();
            if statuses.len() > 1 {
                statuses.remove(0)
            } else {
                statuses[0].clone()
            }
        }

        fn preference(&self) -> Result<HelperPreference, String> {
            self.preference.borrow().clone()
        }

        fn store_decision(&self, decision: HelperDecision) -> Result<(), String> {
            let (act, preference) = match decision {
                HelperDecision::Granted => (Act::StoredGranted, HelperPreference::Granted),
                HelperDecision::Disabled => (Act::StoredDisabled, HelperPreference::Disabled),
            };
            self.did(act);
            *self.preference.borrow_mut() = Ok(preference);
            Ok(())
        }

        fn observe_listener(&self) -> ListenerObservation {
            self.did(Act::ObservedListener);
            self.listener.clone()
        }

        fn status_exchange(&self) -> PeerReply {
            let mut exchanges = self.exchanges.borrow_mut();
            assert!(
                !exchanges.is_empty(),
                "a status exchange the script did not provide"
            );
            exchanges.remove(0).reply()
        }

        fn unregister(&self) -> Result<(), String> {
            self.did(Act::Unregistered);
            self.unregister.clone()
        }

        fn replace_helper(
            &self,
            commit_to_register: &dyn Fn() -> Result<Committed, Reconciled>,
        ) -> Result<(), ReplaceFailure<Reconciled>> {
            self.did(Act::Replaced);
            if self.disable_during_replace {
                *self.preference.borrow_mut() = Ok(HelperPreference::Disabled);
            }
            if let Some(failure) = self.replace.borrow_mut().take() {
                return Err(failure);
            }
            // The live adapter asks the commitment between the kill and the
            // register; a decline is reported verbatim.
            commit_to_register()
                .map(|_committed| ())
                .map_err(ReplaceFailure::RegisterDeclined)
        }

        fn register(&self, _committed: Committed) -> Result<(), RegisterFailure> {
            self.did(Act::Registered);
            match self.register.borrow_mut().take() {
                Some(failure) => Err(failure),
                None => Ok(()),
            }
        }

        fn wait(&self, _interval: Duration) {}
    }

    fn fresh_run(world: &World) -> Reconciled {
        run(&Mutex::new(()), world)
    }

    fn this_build_idle() -> HelperReply {
        status_reply(THIS_BUILD, HelperStateName::Idle, None)
    }

    /// The sentence a stopped report carries, or a failure naming what came
    /// instead.
    fn stopped_text(report: &Reconciled) -> String {
        match report {
            Reconciled::Stopped(text) => text.clone(),
            other => panic!("expected a stopped report, got {other:?}"),
        }
    }

    fn displaced_text(report: &Reconciled) -> String {
        match report {
            Reconciled::Displaced(text) => text.clone(),
            other => panic!("expected a displaced report, got {other:?}"),
        }
    }

    // ── the normal startup ─────────────────────────────────────────────────

    #[test]
    fn a_helper_at_this_build_is_the_resting_state() {
        let world = World::answering(this_build_idle());
        assert_eq!(fresh_run(&world), Reconciled::AtThisBuild);
        assert!(world.acts().is_empty(), "nothing to mutate");
    }

    #[test]
    fn this_builds_helper_running_an_activation_is_still_at_this_build() {
        let world = World::answering(status_reply(
            THIS_BUILD,
            HelperStateName::Activating,
            Some(activation(ClientKind::SyncAgent)),
        ));
        assert_eq!(fresh_run(&world), Reconciled::AtThisBuild);
        assert!(world.acts().is_empty());
    }

    // ── the upgrade ────────────────────────────────────────────────────────

    #[test]
    fn a_different_build_idle_is_replaced_and_verified() {
        let world = World::default().with_exchanges(vec![
            Peer::Answered(status_reply(OTHER_BUILD, HelperStateName::Idle, None)),
            // Verify: the fresh helper answers at this build.
            Peer::Answered(this_build_idle()),
        ]);

        assert_eq!(fresh_run(&world), Reconciled::AtThisBuild);
        assert_eq!(world.acts(), vec![Act::Replaced]);
    }

    #[test]
    fn a_different_build_running_an_activation_is_waited_on_not_touched() {
        // The one deferral in the design: never unregister a helper that
        // reports a running activation. The pass ends; the loop re-observes.
        let info = activation(ClientKind::SyncAgent);
        let world = World::answering(status_reply(
            OTHER_BUILD,
            HelperStateName::Activating,
            Some(info.clone()),
        ));

        assert_eq!(
            fresh_run(&world),
            Reconciled::WaitingOnActivation(Some(info))
        );
        assert!(world.acts().is_empty(), "a deferral mutates nothing");
    }

    #[test]
    fn a_relaunched_helpers_bare_activating_is_waited_on_too() {
        let world = World::answering(status_reply(OTHER_BUILD, HelperStateName::Activating, None));

        assert_eq!(fresh_run(&world), Reconciled::WaitingOnActivation(None));
        assert!(world.acts().is_empty());
    }

    #[test]
    fn a_verified_replacement_accepts_a_fresh_helper_already_activating() {
        // A sync agent can win the race to the fresh helper; that is a
        // working replacement, not a failure.
        let world = World::default().with_exchanges(vec![
            Peer::Answered(status_reply(OTHER_BUILD, HelperStateName::Idle, None)),
            Peer::Answered(status_reply(
                THIS_BUILD,
                HelperStateName::Activating,
                Some(activation(ClientKind::SyncAgent)),
            )),
        ]);

        assert_eq!(fresh_run(&world), Reconciled::AtThisBuild);
    }

    #[test]
    fn verify_retries_while_the_fresh_helper_binds_its_socket() {
        let world = World::default().with_exchanges(vec![
            Peer::Answered(status_reply(OTHER_BUILD, HelperStateName::Idle, None)),
            Peer::Unreachable,
            Peer::Unreachable,
            Peer::Answered(this_build_idle()),
        ]);

        assert_eq!(fresh_run(&world), Reconciled::AtThisBuild);
    }

    #[test]
    fn verify_that_never_hears_an_answer_judges_from_a_fresh_status_read() {
        let unreachable = vec![Peer::Unreachable; VERIFY_LISTEN_ATTEMPTS as usize];
        let mut exchanges = vec![Peer::Answered(status_reply(
            OTHER_BUILD,
            HelperStateName::Idle,
            None,
        ))];
        exchanges.extend(unreachable);

        // The fresh read finds requiresApproval: the pending state, not a
        // failure — macOS wanted a new approval for the replacement.
        let world = World::default()
            .with_exchanges(exchanges.clone())
            .with_statuses(vec![
                Ok(RegistrationStatus::Enabled),          // converge's read
                Ok(RegistrationStatus::Enabled),          // verify's first read
                Ok(RegistrationStatus::RequiresApproval), // the fresh read
            ]);
        assert_eq!(fresh_run(&world), Reconciled::PendingApproval);

        // Still enabled and still silent: a real verification failure.
        let world = World::default().with_exchanges(exchanges);
        assert_eq!(
            stopped_text(&fresh_run(&world)),
            "the registered helper never answered on its socket"
        );
    }

    #[test]
    fn a_wrong_build_answering_verification_is_a_failure() {
        let world = World::default().with_exchanges(vec![
            Peer::Answered(status_reply(OTHER_BUILD, HelperStateName::Idle, None)),
            Peer::Answered(status_reply(OTHER_BUILD, HelperStateName::Idle, None)),
        ]);

        assert_eq!(
            stopped_text(&fresh_run(&world)),
            format!("the registered helper reports build {OTHER_BUILD}, not this build")
        );
    }

    // ── absence, and what does not prove it ────────────────────────────────

    #[test]
    fn an_enabled_registration_with_positively_no_listener_is_replaced() {
        let world = World::default()
            .with_exchanges(vec![Peer::Unreachable, Peer::Answered(this_build_idle())]);

        assert_eq!(fresh_run(&world), Reconciled::AtThisBuild);
        assert_eq!(world.acts(), vec![Act::ObservedListener, Act::Replaced]);
    }

    #[test]
    fn an_absence_that_could_not_be_established_mutates_nothing() {
        for listener in [
            ListenerObservation::Listening,
            ListenerObservation::Ambiguous("timed out".to_string()),
        ] {
            let world = World {
                listener,
                exchanges: RefCell::new(vec![Peer::Unreachable]),
                ..World::default()
            };

            assert!(
                stopped_text(&fresh_run(&world)).starts_with("the helper socket is unusable: ")
            );
            assert_eq!(world.acts(), vec![Act::ObservedListener]);
        }
    }

    // ── the legacy / unverifiable helper ───────────────────────────────────

    #[test]
    fn an_unverifiable_root_peer_is_replaced_without_being_asked() {
        let world = World::default().with_exchanges(vec![
            Peer::RootUnverifiable,
            Peer::Answered(this_build_idle()),
        ]);

        assert_eq!(fresh_run(&world), Reconciled::AtThisBuild);
        assert_eq!(world.acts(), vec![Act::Replaced]);
    }

    #[test]
    fn an_unverifiable_root_peer_is_removed_when_the_user_disabled() {
        let world = World {
            preference: RefCell::new(Ok(HelperPreference::Disabled)),
            exchanges: RefCell::new(vec![Peer::RootUnverifiable]),
            ..World::default()
        };

        assert_eq!(fresh_run(&world), Reconciled::Removed);
        assert_eq!(world.acts(), vec![Act::Unregistered]);
    }

    #[test]
    fn an_unidentified_peer_authorizes_nothing() {
        let world = World::default().with_exchanges(vec![Peer::Unidentified]);

        assert!(
            stopped_text(&fresh_run(&world))
                .starts_with("the helper socket is held by something unidentified: ")
        );
        assert!(world.acts().is_empty());
    }

    // ── the rest of the status × goal table ────────────────────────────────

    #[test]
    fn nothing_registered_and_granted_registers_fresh_and_verifies() {
        let world = World::default()
            .with_statuses(vec![
                Ok(RegistrationStatus::NotRegistered),
                Ok(RegistrationStatus::Enabled),
            ])
            .with_exchanges(vec![Peer::Answered(this_build_idle())]);

        assert_eq!(fresh_run(&world), Reconciled::AtThisBuild);
        assert_eq!(world.acts(), vec![Act::Registered]);
    }

    #[test]
    fn nothing_registered_and_nothing_wanted_is_no_helper() {
        for preference in [HelperPreference::Disabled, HelperPreference::Unset] {
            let world = World {
                preference: RefCell::new(Ok(preference)),
                status: RefCell::new(vec![Ok(RegistrationStatus::NotRegistered)]),
                ..World::default()
            };

            assert_eq!(fresh_run(&world), Reconciled::NoHelper);
            assert!(world.acts().is_empty());
        }
    }

    #[test]
    fn a_pending_approval_is_reported_and_never_reregistered() {
        let world = World {
            status: RefCell::new(vec![Ok(RegistrationStatus::RequiresApproval)]),
            ..World::default()
        };

        assert_eq!(fresh_run(&world), Reconciled::PendingApproval);
        assert!(world.acts().is_empty(), "no registration churn");
    }

    #[test]
    fn a_pending_approval_is_removed_when_the_user_disabled() {
        let world = World {
            preference: RefCell::new(Ok(HelperPreference::Disabled)),
            status: RefCell::new(vec![Ok(RegistrationStatus::RequiresApproval)]),
            ..World::default()
        };

        assert_eq!(fresh_run(&world), Reconciled::Removed);
        assert_eq!(world.acts(), vec![Act::Unregistered]);
    }

    #[test]
    fn an_existing_registration_is_adopted_as_the_users_earlier_opt_in() {
        let world = World {
            preference: RefCell::new(Ok(HelperPreference::Unset)),
            exchanges: RefCell::new(vec![Peer::Answered(this_build_idle())]),
            ..World::default()
        };

        assert_eq!(fresh_run(&world), Reconciled::AtThisBuild);
        assert_eq!(world.acts(), vec![Act::StoredGranted]);
    }

    #[test]
    fn a_broken_service_definition_stops_the_pass() {
        let world = World {
            status: RefCell::new(vec![Ok(RegistrationStatus::NotFound)]),
            ..World::default()
        };

        assert_eq!(fresh_run(&world), Reconciled::ServiceDefinitionBroken);
    }

    // ── refusals and failures that end a pass ──────────────────────────────

    #[test]
    fn a_reply_that_is_not_a_status_is_a_refusal() {
        let world = World::answering(HelperReply::RequestNotUnderstood);

        assert!(stopped_text(&fresh_run(&world)).starts_with("the helper refused: "));
        assert!(world.acts().is_empty());
    }

    #[test]
    fn exchange_failures_end_the_pass_without_mutating() {
        for (peer, expected) in [
            (Peer::ClosedBeforeReply, "the helper socket is unusable: "),
            (
                Peer::Unparseable,
                "the helper sent a reply this build cannot parse: ",
            ),
        ] {
            let world = World::default().with_exchanges(vec![peer]);
            assert!(stopped_text(&fresh_run(&world)).starts_with(expected));
            assert!(world.acts().is_empty());
        }
    }

    #[test]
    fn an_unreadable_registration_stops_before_anything_else() {
        let world = World::default().with_statuses(vec![Err("no service".to_string())]);

        assert_eq!(
            stopped_text(&fresh_run(&world)),
            "the helper registration could not be read: no service"
        );
    }

    #[test]
    fn a_failed_unregister_is_reported() {
        let world = World {
            preference: RefCell::new(Ok(HelperPreference::Disabled)),
            exchanges: RefCell::new(vec![Peer::Answered(status_reply(
                OTHER_BUILD,
                HelperStateName::Idle,
                None,
            ))]),
            unregister: Err("not permitted".to_string()),
            ..World::default()
        };

        assert_eq!(
            stopped_text(&fresh_run(&world)),
            "the helper could not be unregistered: not permitted"
        );
    }

    #[test]
    fn a_disable_recorded_mid_replacement_declines_the_register() {
        // The commitment re-reads the stored decision between the kill and
        // the register; this world flips it just before the pass gets there.
        let world = World {
            disable_during_replace: true,
            ..World::default().with_exchanges(vec![Peer::Answered(status_reply(
                OTHER_BUILD,
                HelperStateName::Idle,
                None,
            ))])
        };

        assert_eq!(
            stopped_text(&fresh_run(&world)),
            "the helper is no longer granted; it was being replaced"
        );
    }

    // ── the gates ──────────────────────────────────────────────────────────

    fn refused() -> Result<(), Reconciled> {
        Err(Reconciled::Displaced("moved".to_string()))
    }

    #[test]
    fn a_displaced_copy_reports_and_touches_nothing() {
        let world = World::default().with_gates(vec![refused()]);

        assert_eq!(displaced_text(&fresh_run(&world)), "moved");
        assert!(world.acts().is_empty());
    }

    #[test]
    fn a_displaced_copy_records_no_decision_either() {
        let world = World::default().with_gates(vec![refused()]);

        let report = decide(&Mutex::new(()), &world, HelperDecision::Granted);

        assert!(matches!(report, Reconciled::Displaced(_)));
        assert!(world.acts().is_empty(), "the gates cover the write");
    }

    #[test]
    fn the_adoption_write_is_behind_a_gate_of_its_own() {
        // The pass's own gate is open; the one immediately before the write is
        // not, and nothing is recorded.
        let world = World {
            preference: RefCell::new(Ok(HelperPreference::Unset)),
            ..World::default().with_gates(vec![Ok(()), refused()])
        };

        assert_eq!(displaced_text(&fresh_run(&world)), "moved");
        assert!(world.acts().is_empty(), "nothing adopted behind the gate");
    }

    #[test]
    fn the_mutation_is_behind_a_gate_of_its_own() {
        // Same shape one step later: the pass classifies a helper it would
        // replace, and the gate in front of the replacement refuses.
        let world = World::default()
            .with_gates(vec![Ok(()), refused()])
            .with_exchanges(vec![Peer::Answered(status_reply(
                OTHER_BUILD,
                HelperStateName::Idle,
                None,
            ))]);

        assert_eq!(displaced_text(&fresh_run(&world)), "moved");
        assert!(world.acts().is_empty(), "nothing replaced behind the gate");
    }

    #[test]
    fn the_gate_judgment_reads_the_three_facts_it_is_about() {
        let installed = InstallLocation::Canonical(PathBuf::from("/Applications/nixmac.app"));

        assert_eq!(
            judge_gates(&installed, THIS_BUILD, Ok(THIS_BUILD.to_string())),
            Ok(())
        );

        // Not in /Applications, with and without an observed path — and the
        // on-disk stamp is never what such a copy is judged on.
        let elsewhere = InstallLocation::Elsewhere(Some(PathBuf::from("/tmp/nixmac.app")));
        assert_eq!(
            judge_gates(&elsewhere, THIS_BUILD, Err("unreadable".to_string())),
            Err(Reconciled::Displaced(
                "nixmac runs from /tmp/nixmac.app — move it to /Applications".to_string()
            ))
        );
        assert_eq!(
            judge_gates(
                &InstallLocation::Elsewhere(None),
                THIS_BUILD,
                Err("unreadable".to_string())
            ),
            Err(Reconciled::Displaced(
                "nixmac is not running from an app bundle in /Applications".to_string()
            ))
        );

        // The bundle was replaced underneath this process.
        assert_eq!(
            judge_gates(&installed, THIS_BUILD, Ok("build-newer".to_string())),
            Err(Reconciled::Displaced(format!(
                "this app was replaced while running (build {THIS_BUILD} is running, build-newer is installed) — restart nixmac"
            )))
        );

        // An unanswered gate mutates nothing, and says why.
        assert_eq!(
            judge_gates(&installed, THIS_BUILD, Err("no Info.plist".to_string())),
            Err(Reconciled::Stopped(
                "this app's installed build could not be read: no Info.plist".to_string()
            ))
        );
    }

    // ── the single-flight slot ─────────────────────────────────────────────

    #[test]
    fn a_second_caller_is_told_busy() {
        // The slot is a plain try-lock: a caller that finds it held is turned
        // away at once and mutates nothing. Releasing it on every path out of
        // a run, a panic included, is `MutexGuard`'s own `Drop`.
        let running = Mutex::new(());
        let world = World::answering(this_build_idle());

        let held = running.lock().expect("a fresh lock");
        assert_eq!(run(&running, &world), Reconciled::Busy);
        assert!(world.acts().is_empty(), "a turned-away caller does nothing");

        drop(held);
        assert_eq!(run(&running, &world), Reconciled::AtThisBuild);
    }

    #[test]
    fn a_decision_waits_out_an_in_flight_pass_and_then_runs_its_own() {
        // The pass that carries a decision out must always exist: the
        // convergence loop only re-runs while it has something left to do,
        // so a decision that merely took `Busy` against the loop's final
        // pass would never be read. A decision therefore blocks on the slot
        // and then makes its own pass.
        let running = Mutex::new(());
        let held = running.lock().expect("a fresh lock");
        std::thread::scope(|scope| {
            let decided = scope.spawn(|| {
                let world = World {
                    status: RefCell::new(vec![
                        Ok(RegistrationStatus::NotRegistered),
                        Ok(RegistrationStatus::Enabled),
                    ]),
                    exchanges: RefCell::new(vec![Peer::Answered(this_build_idle())]),
                    ..World::default()
                };
                let report = decide(&running, &world, HelperDecision::Granted);
                (report, world.acts())
            });
            // Give the decision time to reach the slot. It must still be
            // waiting — not returned with Busy — when the slot frees.
            std::thread::sleep(Duration::from_millis(100));
            assert!(
                !decided.is_finished(),
                "the decision did not wait for the slot"
            );
            drop(held);

            let (report, acts) = decided.join().expect("decide");
            // NotRegistered + the stored Grant: the decision's own pass ran
            // the registration it was stored for.
            assert_eq!(report, Reconciled::AtThisBuild);
            assert_eq!(acts, vec![Act::StoredGranted, Act::Registered]);
        });
    }
}
