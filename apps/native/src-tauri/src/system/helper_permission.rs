//! The unattended sync helper, as the app's permission surface sees it.
//!
//! One reconciliation function decides everything about the installed helper
//! (`privileged_helper::reconcile`). This module is the only place the GUI calls
//! it from, and it owns the wiring plus the one shared presentation window:
//!
//!   * [`observe`] for startup and status refreshes, plus [`grant`], [`retry`],
//!     and [`disable`] for explicit user actions;
//!   * [`describe`] and [`row`], which turn one run's report into the sentence
//!     and the permission state the UI shows.
//!
//! Opening Login Items lives here too, and only in [`grant`]: startup and
//! refreshes run the same reconciliation function, so no report opens System
//! Settings except through the click whose run produced it — however pending the
//! approval a report describes, a run no click is waiting on opens nothing.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Runtime};

use crate::privileged_helper::reconcile::{self, LiveEnvironment, Reconciled};
use crate::privileged_helper::service::{self, RegistrationStatus};
use crate::shared_types::{HelperPermissionPhase, PermissionStatus};
use crate::state::permissions_state;
use crate::system::permissions;

const APPROVE_IN_LOGIN_ITEMS: &str = "Allow nixmac in System Settings → General → Login Items & Extensions to finish enabling unattended sync.";
const FINISHING_SETUP: &str = "nixmac is finishing unattended sync setup.";
const HELPER_UPDATE_FAILED: &str = "nixmac couldn’t update the unattended sync helper. Try again. If this keeps happening, report the problem.";
const ACTION_FAILED: &str = "nixmac couldn’t finish changing the unattended sync helper. Try again. If this keeps happening, report the problem.";
const SERVICE_DEFINITION_BROKEN: &str =
    "This copy of nixmac can’t install its unattended sync helper. Reinstall or update nixmac.";

/// Reconciles the installed helper with this build, and reports.
///
/// Cheap on its normal path (one `Status` exchange), so startup and every
/// status refresh run it. It opens System Settings for nothing it observes: only
/// [`grant`] does that, from what the click itself saw.
///
/// Must not run on the main thread: the register and replace calls it may make
/// are issued *on* the main queue and awaited, so a main-thread caller would
/// starve the queue that has to make them. Those two refuse up front rather than
/// wait out the call window and misreport the silence. The other two,
/// `registration_status` and `unregister`, are issued inline and would proceed —
/// so a main-thread run that only has to read a status or remove a helper is not
/// caught by that refusal.
pub fn observe<R: Runtime>(app: &AppHandle<R>) -> Reconciled {
    observe_with(&PRESENTATION, || {
        reconcile::reconcile(&LiveEnvironment::new(app))
    })
}

fn observe_with(
    presentation: &FailurePresentation,
    observe: impl FnOnce() -> Reconciled,
) -> Reconciled {
    let generation = presentation.generation();
    let report = observe();
    presentation.note_settled_report(&report, generation);
    report
}

/// The explicit Grant action: record the decision, reconcile under it, and open
/// Login Items when macOS is waiting on the user there.
///
/// This function is the only thing in nixmac that opens System Settings for the
/// helper, which is what keeps startup and refreshes from ever doing it: they
/// call [`observe`], and no report can open anything on its own account however
/// pending the approval it describes.
///
/// It opens the pane in the two places a click can learn that macOS is waiting.
/// At most one fires per click — the second is guarded on the first — and which
/// one depends only on what this call saw, never on which pass happened to
/// report first:
///
///   * **before the run**, when the registration is already waiting for
///     approval. The row's button says "Open Settings" in that state, so opening
///     it is the click's own action and does not depend on the run at all — the
///     run may still report something else, and that is not a reason for the
///     click to do nothing visible.
///   * **after the run**, when this run is the one that registered and macOS now
///     wants approval for it. That is the first-time Enable path, where nothing
///     was waiting when the click landed.
///
/// A decision is never answered `Busy`: it waits out an in-flight pass and then
/// makes its own (see `reconcile::decide`), so the report this returns is always
/// the pass that carried the click out.
///
/// [`observe`]'s must-not-run-on-the-main-thread rule applies here with more
/// force: a main-thread decision would block on the slot while the holder's
/// pass may be awaiting a main-queue dispatch — a deadlock, where an
/// observation merely misreports. Every current caller is an async handler.
pub fn grant<R: Runtime>(app: &AppHandle<R>) -> Reconciled {
    let generation = PRESENTATION.begin_user_attempt();
    // Read before the run, because the run is what changes it.
    let awaiting_approval_already = matches!(
        service::registration_status(),
        Ok(RegistrationStatus::RequiresApproval)
    );
    if awaiting_approval_already {
        service::open_login_items_settings();
    }
    let report = reconcile::grant(&LiveEnvironment::new(app));
    PRESENTATION.note_settled_report(&report, generation);
    if !awaiting_approval_already && matches!(report, Reconciled::PendingApproval) {
        service::open_login_items_settings();
    }
    start_converging(app);
    report
}

/// Retry the stored decision without changing it or opening System Settings.
///
/// This is deliberately separate from [`grant`]: a failed, already-enabled
/// helper needs another reconciliation attempt, not another opt-in action.
pub fn retry<R: Runtime>(app: &AppHandle<R>) -> Reconciled {
    let generation = PRESENTATION.begin_user_attempt();
    let report = reconcile::retry(&LiveEnvironment::new(app));
    PRESENTATION.note_settled_report(&report, generation);
    if matches!(report, Reconciled::Stopped(_)) {
        // This was an explicit, bounded retry whose progress the button showed.
        // If that pass still stopped, keep recovery available rather than
        // leaving a spinner up until the slow background cadence wakes again.
        PRESENTATION.show_failure(generation);
    }
    start_converging(app);
    report
}

/// The explicit Disable action: record the decision, then reconcile under it —
/// unregister the helper, deferring while an activation runs, done. Never on
/// the main thread, for [`grant`]'s reason.
pub fn disable<R: Runtime>(app: &AppHandle<R>) -> Reconciled {
    let generation = PRESENTATION.begin_user_attempt();
    let report = reconcile::disable(&LiveEnvironment::new(app));
    PRESENTATION.note_settled_report(&report, generation);
    start_converging(app);
    report
}

/// The permission row for one report: only a helper of this build, ready, is
/// granted, and every report says what it found.
pub fn row(report: &Reconciled) -> (PermissionStatus, String, HelperPermissionPhase) {
    let status = match report {
        Reconciled::AtThisBuild => PermissionStatus::Granted,
        _ => PermissionStatus::Pending,
    };
    let phase = phase(report);
    let detail = match phase {
        HelperPermissionPhase::Reconciling => FINISHING_SETUP.to_string(),
        HelperPermissionPhase::Failed => HELPER_UPDATE_FAILED.to_string(),
        HelperPermissionPhase::NeedsUserAction
            if matches!(report, Reconciled::ServiceDefinitionBroken) =>
        {
            SERVICE_DEFINITION_BROKEN.to_string()
        }
        _ => describe(report),
    };
    (status, detail, phase)
}

/// Friendly detail for helper actions returned outside the permission row.
/// Internal callers that need exact diagnostics continue to use [`describe`].
pub fn action_detail(report: &Reconciled) -> String {
    match report {
        Reconciled::Stopped(_) => ACTION_FAILED.to_string(),
        Reconciled::Busy => FINISHING_SETUP.to_string(),
        Reconciled::ServiceDefinitionBroken => SERVICE_DEFINITION_BROKEN.to_string(),
        _ => describe(report),
    }
}

/// Typed product state for every reconciliation report.
pub fn phase(report: &Reconciled) -> HelperPermissionPhase {
    phase_with_failure_visibility(report, PRESENTATION.failure_visible())
}

fn phase_with_failure_visibility(
    report: &Reconciled,
    stopped_failure_visible: bool,
) -> HelperPermissionPhase {
    match report {
        Reconciled::AtThisBuild => HelperPermissionPhase::Ready,
        Reconciled::PendingApproval => HelperPermissionPhase::ApprovalRequired,
        Reconciled::NoHelper | Reconciled::Removed => HelperPermissionPhase::Disabled,
        Reconciled::Busy => {
            if stopped_failure_visible {
                HelperPermissionPhase::Failed
            } else {
                HelperPermissionPhase::Reconciling
            }
        }
        Reconciled::WaitingOnActivation(_) => HelperPermissionPhase::WaitingForActivation,
        Reconciled::Displaced(_) | Reconciled::ServiceDefinitionBroken => {
            HelperPermissionPhase::NeedsUserAction
        }
        Reconciled::Stopped(_) => {
            if stopped_failure_visible {
                HelperPermissionPhase::Failed
            } else {
                HelperPermissionPhase::Reconciling
            }
        }
    }
}

/// Whether a pane of System Settings is where the user finishes this report.
///
/// `PendingApproval` is the one report where it is: the registration exists and
/// macOS is waiting for the user to approve it in Login Items, and nothing else
/// makes it go. So the row offers the same "Open Settings" action as the other
/// rows that deep-link into System Settings, rather than one more attempt or a
/// way to hand the helper back. [`grant`] is still what the button calls — it
/// records the decision and opens that pane, and does nothing to a registration
/// already waiting there.
///
/// Not "can a later run change this": several reports are equally terminal
/// without a run — a displaced copy has to be moved or restarted (see
/// [`nothing_more_to_do`], which classifies those as final for that reason). What
/// separates this one is *where* the remedy is. The others are answered by a run,
/// or by the user doing something to the app itself, not in System Settings.
pub fn can_request_programmatically(report: &Reconciled) -> bool {
    !matches!(report, Reconciled::PendingApproval)
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
        Reconciled::Busy => "nixmac is still reconciling the unattended sync helper.".to_string(),
        // The one report that says why enabling or disabling is taking
        // minutes: a running activation is never interrupted, and the loop
        // re-observes until it ends.
        Reconciled::WaitingOnActivation(Some(activation)) => format!(
            "nixmac is waiting for a running activation to finish before updating the unattended sync helper ({} submitted by the {}).",
            activation.script_path, activation.client_kind
        ),
        Reconciled::WaitingOnActivation(None) => {
            "nixmac is waiting for a running activation to finish before updating the unattended sync helper.".to_string()
        }
        Reconciled::Displaced(displacement) => sentence(displacement),
        Reconciled::ServiceDefinitionBroken => {
            sentence(&"this app's helper service definition is broken")
        }
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

/// How long retryable reports stay a neutral setup state before the UI offers
/// recovery. This is presentation timing only; the independent safety bound
/// below still governs how many mutations the loop may attempt.
const FAILURE_PRESENTATION_AFTER: Duration = Duration::from_secs(10);

/// Working attempts one loop makes before giving up and leaving repair to the
/// next launch or the next click.
///
/// Only attempts that are *trying to change something* count. Waiting on a human
/// is not failing at anything — see [`drive`] — so this bounds the repetition
/// that could churn a registration, and nothing else.
const MAX_ATTEMPTS: u32 = 100;

/// Shared presentation state for explicit attempts and every row producer.
/// A Retry starts a new display window without resetting the loop's mutation
/// bound. Once its own pass fails, only another attempt or a settled observation
/// clears that failure; the background loop must not reset it again.
/// The generation and visibility change under one lock, so an older observation
/// cannot clear a newer failure between a generation check and its update.
/// No reconciliation, publication, or other external call runs under this lock.
#[derive(Default)]
struct FailurePresentation {
    state: Mutex<FailurePresentationState>,
}

#[derive(Default)]
struct FailurePresentationState {
    generation: u64,
    failure_visible: bool,
    last_failure_detail: Option<String>,
}

static PRESENTATION: FailurePresentation = FailurePresentation {
    state: Mutex::new(FailurePresentationState {
        generation: 0,
        failure_visible: false,
        last_failure_detail: None,
    }),
};

/// Last observed helper failure for the existing opt-in feedback snapshot.
/// Reading it never probes permissions or changes helper registration.
pub(crate) fn last_failure_detail() -> Option<String> {
    PRESENTATION.last_failure_detail()
}

impl FailurePresentation {
    fn generation(&self) -> u64 {
        self.state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .generation
    }

    fn failure_visible(&self) -> bool {
        self.state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .failure_visible
    }

    fn last_failure_detail(&self) -> Option<String> {
        self.state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .last_failure_detail
            .clone()
    }

    fn begin_user_attempt(&self) -> u64 {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        state.generation = state.generation.wrapping_add(1);
        state.failure_visible = false;
        state.generation
    }

    fn show_failure(&self, generation: u64) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if state.generation == generation {
            state.failure_visible = true;
        }
    }

    fn note_settled_report(&self, report: &Reconciled, generation: u64) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if state.generation != generation || matches!(report, Reconciled::Busy) {
            return;
        }
        state.last_failure_detail = match report {
            Reconciled::Stopped(_) => Some(describe(report)),
            _ => None,
        };
        if !matches!(report, Reconciled::Stopped(_)) {
            state.failure_visible = false;
        }
    }
}

fn should_show_failure(elapsed: Duration, working: u32) -> bool {
    elapsed >= FAILURE_PRESENTATION_AFTER || working >= MAX_ATTEMPTS
}

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
            | Reconciled::ServiceDefinitionBroken
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
            &PRESENTATION,
            || observe(&app),
            |report| {
                permissions_state::replace_row(&app, permissions::helper_row(report));
            },
            std::thread::sleep,
        );
    });
}

/// Run, publish one shared product state, and stop when there is nothing left
/// to do. Retry timing lives here so full refreshes and both UI surfaces read
/// the same phase rather than independently interpreting transient reports.
fn drive(
    presentation: &FailurePresentation,
    attempt: impl FnMut() -> Reconciled,
    publish: impl FnMut(&Reconciled),
    wait: impl FnMut(Duration),
) {
    drive_with_clock(presentation, attempt, publish, wait, Instant::now);
}

fn drive_with_clock(
    presentation: &FailurePresentation,
    mut attempt: impl FnMut() -> Reconciled,
    mut publish: impl FnMut(&Reconciled),
    mut wait: impl FnMut(Duration),
    mut now: impl FnMut() -> Instant,
) {
    // `working` remains solely the mutation-safety bound and cadence selector.
    // Presentation timing is deliberately independent so a human approval or
    // a long activation wait cannot reset the churn limit.
    let mut working = 0;
    let mut user_generation = presentation.generation();
    let mut presentation_started: Option<Instant> = None;
    loop {
        let observed_generation = presentation.generation();
        if observed_generation != user_generation {
            user_generation = observed_generation;
            presentation_started = Some(now());
        } else if presentation_started.is_none() && !presentation.failure_visible() {
            presentation_started = Some(now());
        }

        let attempt_generation = presentation.generation();
        let report = attempt();

        // A user action can begin while this loop's pass owns RUNNING; that
        // action waits for the pass. Do not let the older pass restore a stale
        // failure after the new attempt has already reset its presentation.
        let generation_after_attempt = presentation.generation();
        if generation_after_attempt != user_generation {
            user_generation = generation_after_attempt;
            presentation_started = Some(now());
        }

        // Busy says only that this observation lost the single-flight race. It
        // must not replace an approval, failure, or actionable instruction.
        if matches!(report, Reconciled::Busy) {
            wait(WAITING_INTERVAL);
            continue;
        }

        if nothing_more_to_do(&report) {
            presentation.note_settled_report(&report, attempt_generation);
            publish(&report);
            return;
        }
        // None of these attempted anything. `PendingApproval` is macOS
        // waiting on the user — which may be weeks. `Busy` is another run
        // holding the single-flight slot, so this pass did not even begin.
        // `WaitingOnActivation` is a running activation the pass deferred to —
        // activations take minutes and are never interrupted, so the deferral
        // lives here, in the loop's waiting cadence, rather than as a poll
        // inside a pass. All are cheap, all can persist, and none changed what
        // is registered, so they are neither counted nor hurried, and the loop
        // watches for as long as the app runs. (A truly hung activation is
        // therefore watched forever and reported, never force-killed; the
        // recovery boundary is a reboot.)
        //
        // The subtlety, because the report alone does not carry it: a *mutating*
        // pass can also end at `PendingApproval`, when `verify` finds the
        // registration it just created parked at `requiresApproval`. What keeps
        // that from recurring uncounted is the world, not the report — after it,
        // the registration *is* at `requiresApproval`, so the next pass takes the
        // status × goal table's row and touches nothing. Getting back to a
        // mutating pass takes an external event: an approval, or a removal in
        // Login Items. Every such cycle is therefore paced by a human.
        if matches!(
            report,
            Reconciled::PendingApproval | Reconciled::WaitingOnActivation(_)
        ) {
            // This is a genuine wait boundary, not another failed mutation.
            // Give the work after it a fresh *display* window while leaving the
            // lifetime `working` safety counter untouched.
            presentation_started = None;
            presentation.note_settled_report(&report, attempt_generation);
            publish(&report);
            wait(WAITING_INTERVAL);
            continue;
        }

        debug_assert!(matches!(report, Reconciled::Stopped(_)));
        working += 1;
        let elapsed = presentation_started
            .map(|started| now().saturating_duration_since(started))
            .unwrap_or_default();
        if should_show_failure(elapsed, working) {
            presentation.show_failure(attempt_generation);
        }
        publish(&report);

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

#[cfg(test)]
mod tests {
    use super::*;

    fn stopped(sentence: &str) -> Reconciled {
        Reconciled::Stopped(sentence.to_string())
    }

    fn displaced() -> Reconciled {
        Reconciled::Displaced(
            "nixmac is not running from an app bundle in /Applications".to_string(),
        )
    }

    #[test]
    fn the_loop_stops_on_a_goal_and_on_nothing_else_it_can_fix() {
        for done in [
            Reconciled::AtThisBuild,
            Reconciled::Removed,
            Reconciled::NoHelper,
            displaced(),
            Reconciled::ServiceDefinitionBroken,
        ] {
            assert!(nothing_more_to_do(&done), "{done:?}");
        }
        // Everything else is worth another go — the refusal window, the
        // approval wait, a caller turned away, a helper that has not answered
        // yet, a running activation being waited out.
        for keep_going in [
            Reconciled::PendingApproval,
            Reconciled::Busy,
            Reconciled::WaitingOnActivation(None),
            stopped("the helper could not be registered: not permitted"),
            stopped("the registered helper never answered on its socket"),
            stopped("the helper could not be unregistered: refused"),
            stopped("the helper is no longer granted; it was being replaced"),
        ] {
            assert!(!nothing_more_to_do(&keep_going), "{keep_going:?}");
        }
    }

    #[test]
    fn only_a_pending_approval_hands_the_row_to_the_user() {
        // The one report whose remedy is in System Settings, so the row offers
        // the Login Items deep link rather than an action of nixmac's own.
        assert!(!can_request_programmatically(&Reconciled::PendingApproval));
        // Everything else is answered by a run, or by the user doing something to
        // the app itself — including the reports that ask for a move or a restart,
        // which no pane of System Settings can help with.
        for ours in [
            Reconciled::AtThisBuild,
            Reconciled::NoHelper,
            Reconciled::Removed,
            Reconciled::Busy,
            Reconciled::WaitingOnActivation(None),
            displaced(),
            Reconciled::ServiceDefinitionBroken,
            stopped("the helper could not be registered: not permitted"),
            stopped("the helper could not be unregistered: refused"),
            stopped("the registered helper never answered on its socket"),
        ] {
            assert!(can_request_programmatically(&ours), "{ours:?}");
        }
    }

    #[test]
    fn every_report_has_a_typed_product_phase() {
        for (report, expected) in [
            (Reconciled::AtThisBuild, HelperPermissionPhase::Ready),
            (
                Reconciled::PendingApproval,
                HelperPermissionPhase::ApprovalRequired,
            ),
            (Reconciled::NoHelper, HelperPermissionPhase::Disabled),
            (Reconciled::Removed, HelperPermissionPhase::Disabled),
            (
                Reconciled::WaitingOnActivation(None),
                HelperPermissionPhase::WaitingForActivation,
            ),
            (displaced(), HelperPermissionPhase::NeedsUserAction),
            (
                Reconciled::ServiceDefinitionBroken,
                HelperPermissionPhase::NeedsUserAction,
            ),
        ] {
            assert_eq!(phase_with_failure_visibility(&report, false), expected);
        }

        let stopped = stopped("SMAppServiceErrorDomain 1: operation not permitted");
        assert_eq!(
            phase_with_failure_visibility(&stopped, false),
            HelperPermissionPhase::Reconciling
        );
        assert_eq!(
            phase_with_failure_visibility(&stopped, true),
            HelperPermissionPhase::Failed
        );
    }

    #[test]
    fn technical_stops_are_friendly_only_at_the_row_boundary() {
        let report = stopped("SMAppServiceErrorDomain 1: operation not permitted");
        assert!(describe(&report).contains("SMAppServiceErrorDomain 1"));
        assert!(!action_detail(&report).contains("SMAppServiceErrorDomain"));
    }

    #[test]
    fn presentation_uses_time_without_changing_the_mutation_bound() {
        assert!(!should_show_failure(Duration::from_secs(9), 99));
        assert!(should_show_failure(FAILURE_PRESENTATION_AFTER, 1));
        assert!(should_show_failure(Duration::ZERO, MAX_ATTEMPTS));
    }

    #[test]
    fn feedback_keeps_failure_details_without_changing_friendly_copy() {
        let presentation = FailurePresentation::default();
        let first = presentation.begin_user_attempt();
        let failure = stopped("SMAppServiceErrorDomain 1: registration refused");
        presentation.note_settled_report(&failure, first);
        assert!(
            presentation
                .last_failure_detail()
                .unwrap()
                .contains("SMAppServiceErrorDomain 1")
        );
        assert!(!action_detail(&failure).contains("SMAppServiceErrorDomain"));
        presentation.note_settled_report(&Reconciled::Busy, first);
        assert!(presentation.last_failure_detail().is_some());

        let next = presentation.begin_user_attempt();
        presentation.note_settled_report(&Reconciled::AtThisBuild, first);
        assert!(presentation.last_failure_detail().is_some());
        presentation.note_settled_report(&Reconciled::AtThisBuild, next);
        assert!(presentation.last_failure_detail().is_none());
    }

    #[test]
    fn a_completed_retry_failure_survives_the_background_generation_check() {
        let presentation = FailurePresentation::default();
        let mut attempts = 0;
        let mut phases = Vec::new();
        drive(
            &presentation,
            || {
                attempts += 1;
                if attempts == 1 {
                    // The background pass releases reconciliation's slot, then
                    // Retry runs and fails before this loop publishes its report.
                    let retry_generation = presentation.begin_user_attempt();
                    presentation.show_failure(retry_generation);
                    stopped("the helper could not be registered")
                } else {
                    Reconciled::AtThisBuild
                }
            },
            |report| {
                phases.push(phase_with_failure_visibility(
                    report,
                    presentation.failure_visible(),
                ));
            },
            |_| {},
        );
        assert_eq!(
            phases,
            vec![HelperPermissionPhase::Failed, HelperPermissionPhase::Ready]
        );
    }

    #[test]
    fn a_stale_settled_observation_cannot_clear_a_newer_failed_retry() {
        let presentation = FailurePresentation::default();
        drive(
            &presentation,
            || {
                observe_with(&presentation, || {
                    // This observation already obtained Ready and released the
                    // reconciliation slot. Retry acquires it and fails before
                    // the older observation returns to its presentation code.
                    let retry_generation = presentation.begin_user_attempt();
                    presentation.show_failure(retry_generation);
                    Reconciled::AtThisBuild
                })
            },
            |_| {
                // Both observe() and drive() handle the old settled result
                // before this publisher runs. Neither may clear Retry's latch.
                assert_eq!(
                    phase_with_failure_visibility(
                        &stopped("retry failed"),
                        presentation.failure_visible(),
                    ),
                    HelperPermissionPhase::Failed,
                );
            },
            |_| {},
        );
        assert!(presentation.failure_visible());
    }

    #[test]
    fn the_loop_shows_recovery_after_the_display_window() {
        let presentation = FailurePresentation::default();
        let started = Instant::now();
        let elapsed = std::cell::Cell::new(Duration::ZERO);
        let mut attempts = 0;
        let mut phases = Vec::new();
        drive_with_clock(
            &presentation,
            || {
                attempts += 1;
                if attempts <= 3 {
                    stopped("the helper could not be registered")
                } else {
                    Reconciled::AtThisBuild
                }
            },
            |report| {
                phases.push(phase_with_failure_visibility(
                    report,
                    presentation.failure_visible(),
                ));
            },
            |_| {
                elapsed.set(if elapsed.get().is_zero() {
                    Duration::from_secs(9)
                } else {
                    elapsed.get() + Duration::from_secs(1)
                });
            },
            || started + elapsed.get(),
        );
        assert_eq!(
            phases,
            vec![
                HelperPermissionPhase::Reconciling,
                HelperPermissionPhase::Reconciling,
                HelperPermissionPhase::Failed,
                HelperPermissionPhase::Ready,
            ]
        );
    }

    #[test]
    fn busy_never_replaces_the_last_truthful_row() {
        let mut attempts = 0;
        let mut published = Vec::new();
        drive(
            &FailurePresentation::default(),
            || {
                attempts += 1;
                if attempts == 1 {
                    Reconciled::Busy
                } else {
                    Reconciled::AtThisBuild
                }
            },
            |report| published.push(report.clone()),
            |_| {},
        );
        assert_eq!(published, vec![Reconciled::AtThisBuild]);
    }

    #[test]
    fn it_stops_as_soon_as_the_decision_is_carried_out() {
        let mut attempts = 0;
        let mut waited = Vec::new();
        drive(
            &FailurePresentation::default(),
            || {
                attempts += 1;
                if attempts < 3 {
                    stopped("the helper could not be registered: not permitted")
                } else {
                    Reconciled::AtThisBuild
                }
            },
            |_| {},
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
            &FailurePresentation::default(),
            || {
                attempts += 1;
                if attempts <= MAX_ATTEMPTS * 10 {
                    Reconciled::PendingApproval
                } else {
                    Reconciled::AtThisBuild
                }
            },
            |_| {},
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
            &FailurePresentation::default(),
            || {
                attempts += 1;
                if attempts <= 500 {
                    Reconciled::PendingApproval
                } else {
                    working += 1;
                    stopped("the helper could not be registered: not permitted")
                }
            },
            |_| {},
            |_| {},
        );
        assert_eq!(working, MAX_ATTEMPTS);
    }

    #[test]
    fn it_gives_up_rather_than_running_for_ever() {
        let mut attempts = 0;
        let mut waited = Vec::new();
        drive(
            &FailurePresentation::default(),
            || {
                attempts += 1;
                stopped("the helper could not be registered: not permitted")
            },
            |_| {},
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
