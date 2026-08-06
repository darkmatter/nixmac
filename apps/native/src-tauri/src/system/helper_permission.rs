//! The unattended sync helper, as the app's permission surface sees it.
//!
//! One reconciliation function decides everything about the installed helper
//! (`privileged_helper::reconcile`). This module is the only place the GUI calls
//! it from, and it holds nothing but the wiring:
//!
//!   * [`observe`] for startup and status refreshes, [`grant`] and [`disable`]
//!     for the two explicit user actions;
//!   * [`describe`] and [`row`], which turn one run's report into the sentence
//!     and the permission state the UI shows;
//!   * an [`Environment`] that is the live one plus a display-only note about
//!     the activation a `Retire` is waiting on.
//!
//! Opening Login Items lives here too, and only ever for a [`grant`]: startup
//! and refreshes run the same function, and must never open System Settings on
//! their own account however pending the approval they observe is. What
//! separates them is a flag a Grant click arms — see
//! [`GRANT_AWAITING_REPORT`], which also records what that does not pin down.

use std::os::unix::net::UnixStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use tauri::{AppHandle, Runtime};

use crate::privileged_helper::protocol::ActivationInfo;
use crate::privileged_helper::reconcile::{
    self, Environment, LiveEnvironment, PeerReply, Reconciled, Stopped,
};
use crate::privileged_helper::service::{
    self, RegisterFailure, RegistrationStatus, ReplaceFailure,
};
use crate::privileged_helper::socket_probe::ListenerObservation;
use crate::shared_types::{HelperDecision, HelperPreference, PermissionStatus};
use crate::state::permissions_state;
use crate::system::install_location::InstallLocation;
use crate::system::permissions;

const APPROVE_IN_LOGIN_ITEMS: &str = "Approve nixmac in System Settings → General → Login Items & Extensions to finish enabling the unattended sync helper.";

/// Reconciles the installed helper with this build, and reports.
///
/// Cheap on its normal path (one `Status` exchange), so startup and every
/// status refresh run it. It opens System Settings for nothing it observes on
/// its own account; it can be the run that answers a Grant click, and that
/// click's permission is what opens Login Items ([`GRANT_AWAITING_REPORT`]).
///
/// Must not run on the main thread: the ServiceManagement calls it may make are
/// issued *on* the main queue and awaited, so a main-thread caller would starve
/// the queue that has to make them (the platform adapter refuses outright).
pub fn observe<R: Runtime>(app: &AppHandle<R>) -> Reconciled {
    reconcile::reconcile(&GuiEnvironment::new(app))
}

/// The explicit Grant action: record the decision, reconcile under it, and open
/// Login Items when macOS turns out to be waiting on the user.
///
/// Clicking Grant while a run is in flight is answered `Busy`, and that run owes
/// the decision one more pass — whose report is the answer to this click, and so
/// the one allowed to open Login Items. That is why the permission is armed here
/// and spent in `reported` rather than acted on from this function's own return
/// value: the answering pass may not be this one.
pub fn grant<R: Runtime>(app: &AppHandle<R>) -> Reconciled {
    // Armed before the run, not after: the pass that answers this click can
    // report before this call has even returned.
    GRANT_AWAITING_REPORT.store(true, Ordering::SeqCst);
    let report = reconcile::grant(&GuiEnvironment::new(app));
    if !matches!(report, Reconciled::Busy) {
        // This run's own report was the answer, and it was consumed where every
        // report is. Disarm so no later refresh inherits the click.
        GRANT_AWAITING_REPORT.store(false, Ordering::SeqCst);
    }
    start_converging(app);
    report
}

/// A Grant click still waiting for the report that answers it.
///
/// Nothing may open System Settings without this armed, and only a Grant click
/// arms it: a startup or refresh that observes a pending approval on its own
/// opens nothing. What it does not pin down is *which* pass spends it — a
/// refresh run already in flight can be the one that answers the click. So the
/// worst cases are that the click's Login Items window opens one report later,
/// or not at all and the user clicks Enable again. Settings never opens
/// unasked.
static GRANT_AWAITING_REPORT: AtomicBool = AtomicBool::new(false);

/// The explicit Disable action: record the decision, then reconcile under it —
/// retire the helper if it is running, unregister, done.
pub fn disable<R: Runtime>(app: &AppHandle<R>) -> Reconciled {
    let report = reconcile::disable(&GuiEnvironment::new(app));
    start_converging(app);
    report
}

/// The permission row for one report: only a helper of this build, ready, is
/// granted, and every report says what it found.
pub fn row(report: &Reconciled) -> (PermissionStatus, String) {
    let status = match report {
        Reconciled::AtThisBuild => PermissionStatus::Granted,
        _ => PermissionStatus::Pending,
    };
    (status, describe(report))
}

/// What one report says, in a sentence for the user.
///
/// The vocabulary is the report's own wherever the report carries text of its
/// own (the displaced and stopped-short cases); the resting states have none, so
/// they are phrased here.
pub fn describe(report: &Reconciled) -> String {
    match report {
        Reconciled::AtThisBuild => {
            "The unattended sync helper is installed and answering.".to_string()
        }
        Reconciled::PendingApproval => APPROVE_IN_LOGIN_ITEMS.to_string(),
        Reconciled::NoHelper => {
            "The unattended sync helper is not installed. Enable it to activate builds without a password prompt.".to_string()
        }
        Reconciled::Removed => {
            "The unattended sync helper is disabled and has been removed.".to_string()
        }
        Reconciled::Busy => match waiting_on() {
            // The activation another run is waiting out. This is the only place
            // a user learns why enabling or disabling is taking minutes.
            Some(note) => format!("nixmac is still reconciling the unattended sync helper: {note}."),
            None => "nixmac is still reconciling the unattended sync helper.".to_string(),
        },
        Reconciled::Displaced(displacement) => sentence(displacement),
        Reconciled::Stopped(stopped) => sentence(stopped),
    }
}

// ---------------------------------------------------------------------------
// Converging on the stored decision.
// ---------------------------------------------------------------------------
//
// One reconciliation run is often not enough, and nothing else re-runs it: the
// platform refuses a register for about a second after any unregister, and
// approving in Login Items neither starts the helper nor tells anyone. So a
// launch, and each explicit user action, drives the function until the stored
// decision is carried out. Measured on real hardware: one launch, one Login
// Items toggle, ~30 s, no relaunch.

/// Spacing between attempts, and how many working ones are made at the shorter
/// one.
///
/// The short spacing covers the platform's refusal window — measured at about a
/// second — and the settling that follows a replacement. These are counts of
/// *working* attempts, not wall clock: a run that has to prove the socket absent
/// costs about five seconds of its own, so thirty of them is minutes rather than
/// half a minute.
const FAST_INTERVAL: Duration = Duration::from_secs(1);
const SLOW_INTERVAL: Duration = Duration::from_secs(60);
const FAST_ATTEMPTS: u32 = 30;

/// Spacing while nothing is being attempted. Not derived from the counters
/// above, because a wait is not a streak of failures: it may last weeks, so it
/// must not sit at the short spacing, and it should still notice an approval
/// promptly once it comes.
///
/// Not free, either. Every pass runs the gates first, and those resolve the app
/// bundle twice — `current_exe` and two `canonicalize` each — and parse
/// `Info.plist` for the stamped build id, before the `SMAppService` read. All
/// page-cached and cheap in absolute terms, but this is the app's steady state
/// for as long as an approval is outstanding, so it is a poll rather than a
/// glance.
const WAITING_INTERVAL: Duration = Duration::from_secs(5);

/// Working attempts one loop makes before giving up and leaving repair to the
/// next launch or the next click.
///
/// Only attempts that are *trying to change something* count. Waiting on a human
/// is not failing at anything — see [`drive`] — so this bounds the repetition
/// that could churn a registration, and nothing else.
const MAX_ATTEMPTS: u32 = 100;

/// Whether re-running could still change anything.
fn nothing_more_to_do(report: &Reconciled) -> bool {
    matches!(
        report,
        // The stored decision is carried out — one success state per goal.
        Reconciled::AtThisBuild | Reconciled::Removed | Reconciled::NoHelper
        // Or nothing this loop can do will change the answer. A displaced copy
        // must be moved or restarted, and neither takes effect in a running
        // process: `current_exe` reports the path the process was launched from,
        // and the realistic route here is a quarantined copy, which macOS runs
        // from a read-only mount that is never under /Applications. A broken
        // service definition is a property of the bundle, read identically every
        // time.
            | Reconciled::Displaced(_)
            | Reconciled::Stopped(Stopped::ServiceDefinitionBroken)
    )
}

/// The one loop, as a flag rather than a handle: nothing waits on it, cancels
/// it, or asks it anything.
static CONVERGING: AtomicBool = AtomicBool::new(false);

/// Held for a loop's lifetime, and released by `Drop` on every way out
/// including a panic — a leaked flag is permanent, since nothing else clears it.
///
/// A unit struct on purpose. An earlier version passed a value carrying the flag
/// into `bool::then_some`, which evaluates its argument eagerly: the guard was
/// built and dropped on the *refused* path too, releasing the running loop's
/// flag, and loops doubled every tick until the process ran out of threads.
/// There is nothing here for a claim to construct speculatively.
struct Converging;

impl Drop for Converging {
    fn drop(&mut self) {
        CONVERGING.store(false, Ordering::SeqCst);
    }
}

/// Starts a loop unless one is already running.
///
/// Startup calls this, and so does every explicit user action — a click has to
/// keep trying if its first attempt stops short, not wait for the next launch.
/// A loop already running needs no help: every pass re-reads the stored decision,
/// so it picks up a Grant or a Disable by itself.
pub fn start_converging<R: Runtime>(app: &AppHandle<R>) {
    // A build that reports every permission granted without probing must not go
    // and register a real helper behind that fiction. `replace_row` refuses too,
    // but this is the one that keeps `SMAppService` untouched.
    if permissions::skip_enabled() {
        return;
    }
    if CONVERGING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    // Built only after the claim succeeded, and moved into the closure — so a
    // `spawn` that fails drops it and gives the flag back.
    let guard = Converging;
    let app = app.clone();
    // Off the calling thread for two reasons. It must not be the main thread:
    // the ServiceManagement calls are issued *on* the main queue and awaited, so
    // a main-thread caller would starve the queue it is waiting on, and the
    // adapter refuses outright. And its own thread rather than the blocking
    // pool, because this one sleeps for as long as an approval takes — a pool
    // slot it would never give back.
    std::thread::spawn(move || {
        let _guard = guard;
        drive(
            || {
                let report = observe(&app);
                permissions_state::replace_row(&app, permissions::helper_row(&report));
                report
            },
            std::thread::sleep,
        );
    });
}

/// Run, publish, stop when there is nothing left to do, otherwise wait and go
/// again.
fn drive(mut attempt: impl FnMut() -> Reconciled, mut wait: impl FnMut(Duration)) {
    let mut working = 0;
    loop {
        let report = attempt();
        if nothing_more_to_do(&report) {
            return;
        }
        // Neither of these attempted anything. `PendingApproval` is macOS
        // waiting on the user — §8.6 says that may be weeks — and `Busy` is
        // another run holding the single-flight slot, so this pass did not even
        // begin. Both are cheap, both can persist, and neither changed what is
        // registered, so they are neither counted nor hurried, and the loop
        // watches for as long as the app runs.
        //
        // The subtlety, because the report alone does not carry it: a *mutating*
        // pass can also end at `PendingApproval`, when `verify` finds the
        // registration it just created parked at `requiresApproval`. What keeps
        // that from recurring uncounted is the world, not the report — after it,
        // the registration *is* at `requiresApproval`, so the next pass takes the
        // status × goal table's row and touches nothing. Getting back to a
        // mutating pass takes an external event: an approval, or a removal in
        // Login Items. Every such cycle is therefore paced by a human.
        if matches!(report, Reconciled::PendingApproval | Reconciled::Busy) {
            wait(WAITING_INTERVAL);
            continue;
        }
        working += 1;
        if working >= MAX_ATTEMPTS {
            log::warn!(
                "helper convergence: giving up after {working} attempts, last report {report:?}; \
                 repair is left to the next launch or user action"
            );
            return;
        }
        wait(if working < FAST_ATTEMPTS {
            FAST_INTERVAL
        } else {
            SLOW_INTERVAL
        });
    }
}

/// One report, terminated.
///
/// The reports are written as clauses and carry no full stop; several of them
/// start with "nixmac", so the first letter is left exactly as the report wrote
/// it rather than upper-cased into a different product name.
fn sentence(report: &impl std::fmt::Display) -> String {
    let report = report.to_string();
    if report.ends_with(['.', '!', '?']) {
        report
    } else {
        format!("{report}.")
    }
}

/// The activation a `Retire` loop is currently waiting on, for display only.
///
/// Not state: nothing decides anything from it, it is never persisted, and a run
/// that ends clears it. It exists because a run that waits — legitimately, for
/// as long as an activation takes — is otherwise silent to a second caller,
/// which is exactly the caller that has a UI to update.
static WAITING_ON: Mutex<Option<String>> = Mutex::new(None);

fn waiting_on() -> Option<String> {
    WAITING_ON
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone()
}

fn set_waiting_on(note: Option<String>) {
    *WAITING_ON.lock().unwrap_or_else(PoisonError::into_inner) = note;
}

/// The live environment, plus the display-only note above.
///
/// Everything else is delegated verbatim: this is not a second reconciliation
/// procedure, and it holds no decision of its own.
struct GuiEnvironment<'a, R: Runtime> {
    live: LiveEnvironment<'a, R>,
}

impl<'a, R: Runtime> GuiEnvironment<'a, R> {
    fn new(app: &'a AppHandle<R>) -> Self {
        Self {
            live: LiveEnvironment::new(app),
        }
    }
}

impl<R: Runtime> Environment for GuiEnvironment<'_, R> {
    type Held = UnixStream;

    fn install_location(&self) -> InstallLocation {
        self.live.install_location()
    }

    fn compiled_build_id(&self) -> &str {
        self.live.compiled_build_id()
    }

    fn bundle_build_id(&self) -> Result<String, String> {
        self.live.bundle_build_id()
    }

    fn registration_status(&self) -> Result<RegistrationStatus, String> {
        self.live.registration_status()
    }

    fn preference(&self) -> Result<HelperPreference, String> {
        self.live.preference()
    }

    fn store_decision(&self, decision: HelperDecision) -> Result<(), String> {
        self.live.store_decision(decision)
    }

    fn observe_listener(&self) -> ListenerObservation {
        self.live.observe_listener()
    }

    fn status_exchange(&self) -> PeerReply<Self::Held> {
        self.live.status_exchange()
    }

    fn retire_exchange(&self) -> PeerReply<Self::Held> {
        self.live.retire_exchange()
    }

    fn peer_still_open(&self, held: &Self::Held) -> bool {
        self.live.peer_still_open(held)
    }

    fn unregister(&self) -> Result<(), String> {
        self.live.unregister()
    }

    fn replace_helper(
        &self,
        commit_to_register: &dyn Fn() -> Result<reconcile::Committed, Reconciled>,
    ) -> Result<(), ReplaceFailure<Reconciled>> {
        self.live.replace_helper(commit_to_register)
    }

    fn register(&self, committed: reconcile::Committed) -> Result<(), RegisterFailure> {
        self.live.register(committed)
    }

    fn wait(&self, interval: Duration) {
        self.live.wait(interval);
    }

    fn waiting_on_activation(&self, activation: &ActivationInfo) {
        set_waiting_on(Some(format!(
            "waiting for a running activation to finish ({} submitted by the {})",
            activation.script_path, activation.client_kind
        )));
        self.live.waiting_on_activation(activation);
    }

    fn reported(&self, outcome: &Reconciled) {
        // A pass that ended is no longer waiting on anything. `Busy` is the one
        // report that does not end a pass — it comes from a *caller* that found
        // one in flight, and that pass may still be waiting.
        if !matches!(outcome, Reconciled::Busy) {
            set_waiting_on(None);
            // This pass is the answer to any Grant click still waiting for one.
            if GRANT_AWAITING_REPORT.swap(false, Ordering::SeqCst)
                && matches!(outcome, Reconciled::PendingApproval)
            {
                service::open_login_items_settings();
            }
        }
        self.live.reported(outcome);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::privileged_helper::reconcile::Displacement;

    fn stopped(reason: Stopped) -> Reconciled {
        Reconciled::Stopped(reason)
    }

    #[test]
    fn the_loop_stops_on_a_goal_and_on_nothing_else_it_can_fix() {
        for done in [
            Reconciled::AtThisBuild,
            Reconciled::Removed,
            Reconciled::NoHelper,
            Reconciled::Displaced(Displacement::NotInstalledInApplications(None)),
            stopped(Stopped::ServiceDefinitionBroken),
        ] {
            assert!(nothing_more_to_do(&done), "{done:?}");
        }
        // Everything else is worth another go — the refusal window, the
        // approval wait, a caller turned away, a helper that has not answered
        // yet.
        for keep_going in [
            Reconciled::PendingApproval,
            Reconciled::Busy,
            stopped(Stopped::RegisterFailed("not permitted".to_string())),
            stopped(Stopped::VerifyNeverAnswered),
            stopped(Stopped::UnregisterFailed("refused".to_string())),
            stopped(Stopped::PasswordActivationRunning),
        ] {
            assert!(!nothing_more_to_do(&keep_going), "{keep_going:?}");
        }
    }

    #[test]
    fn it_stops_as_soon_as_the_decision_is_carried_out() {
        let mut attempts = 0;
        let mut waited = Vec::new();
        drive(
            || {
                attempts += 1;
                if attempts < 3 {
                    stopped(Stopped::RegisterFailed("not permitted".to_string()))
                } else {
                    Reconciled::AtThisBuild
                }
            },
            |interval| waited.push(interval),
        );
        assert_eq!(attempts, 3);
        // Waited between attempts, and not after the last one.
        assert_eq!(waited, vec![FAST_INTERVAL; 2]);
    }

    #[test]
    fn waiting_on_a_human_is_never_counted_against_the_bound() {
        // §8.6 says the approval may arrive weeks later, and the poll that
        // observes it registers nothing. So the loop must still be watching long
        // after a bound on working attempts would have stopped it.
        let mut attempts = 0;
        let mut waited = Vec::new();
        drive(
            || {
                attempts += 1;
                if attempts <= MAX_ATTEMPTS * 10 {
                    Reconciled::PendingApproval
                } else {
                    Reconciled::AtThisBuild
                }
            },
            |interval| waited.push(interval),
        );
        assert_eq!(attempts, MAX_ATTEMPTS * 10 + 1, "the loop stopped watching");
        // And it waits at the waiting spacing throughout — the working counter
        // never moves, so it must not be what picks the interval.
        assert!(waited.iter().all(|i| *i == WAITING_INTERVAL));
    }

    #[test]
    fn a_wait_that_turns_into_work_is_still_bounded() {
        // The pending polls are free, but the moment the approval lands and the
        // repair starts failing, the bound applies to those attempts.
        let mut attempts = 0;
        let mut working = 0;
        drive(
            || {
                attempts += 1;
                if attempts <= 500 {
                    Reconciled::PendingApproval
                } else {
                    working += 1;
                    stopped(Stopped::RegisterFailed("not permitted".to_string()))
                }
            },
            |_| {},
        );
        assert_eq!(working, MAX_ATTEMPTS);
    }

    #[test]
    fn it_gives_up_rather_than_running_for_ever() {
        let mut attempts = 0;
        let mut waited = Vec::new();
        drive(
            || {
                attempts += 1;
                stopped(Stopped::RegisterFailed("not permitted".to_string()))
            },
            |interval| waited.push(interval),
        );
        assert_eq!(attempts, MAX_ATTEMPTS);
        assert_eq!(waited.len(), (MAX_ATTEMPTS - 1) as usize);
        // Quick while the platform might still be settling, patient afterwards.
        assert!(
            waited[..(FAST_ATTEMPTS - 1) as usize]
                .iter()
                .all(|i| *i == FAST_INTERVAL)
        );
        assert!(
            waited[(FAST_ATTEMPTS - 1) as usize..]
                .iter()
                .all(|i| *i == SLOW_INTERVAL)
        );
    }

    #[test]
    fn the_claim_primitives_hold_one_loop_and_survive_a_panic() {
        // Note this drives `CONVERGING` and `Converging` directly, not
        // `start_converging` — the claim/spawn/guard *sequencing* in that
        // function is what once had the doubling bug, and it is not covered
        // here.
        assert!(
            CONVERGING
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
        );
        assert!(
            CONVERGING
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_err(),
            "a second loop claimed a taken flag"
        );
        // A refused claim must not release what the holder has — the bug that
        // spawned loops until the process ran out of threads.
        assert!(CONVERGING.load(Ordering::SeqCst));

        let outcome = std::panic::catch_unwind(|| {
            let _guard = Converging;
            panic!("the run panicked");
        });
        assert!(outcome.is_err());
        assert!(
            !CONVERGING.load(Ordering::SeqCst),
            "the flag was leaked by a panic"
        );
    }
}
