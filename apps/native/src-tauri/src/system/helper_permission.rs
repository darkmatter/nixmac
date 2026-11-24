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
use crate::shared_types::{HelperPermissionPhase, HelperPreference, PermissionStatus};
use crate::state::{permissions_state, preferences};
use crate::system::permissions;

const APPROVE_IN_LOGIN_ITEMS: &str = "Allow nixmac in System Settings → General → Login Items & Extensions to finish enabling unattended sync.";
const FINISHING_SETUP: &str = "nixmac is finishing unattended sync setup.";
const HELPER_UPDATE_FAILED: &str = "nixmac couldn’t update the unattended sync helper. Try again. If this keeps happening, report the problem.";
const ACTION_FAILED: &str = "nixmac couldn’t finish changing the unattended sync helper. Try again. If this keeps happening, report the problem.";
const SERVICE_DEFINITION_BROKEN: &str =
    "This copy of nixmac can’t install its unattended sync helper. Reinstall or update nixmac.";
const REMOVING: &str = "nixmac is removing the unattended sync helper.";
const REMOVAL_FAILED: &str = "nixmac couldn’t remove the unattended sync helper. Try again. If this keeps happening, report the problem.";
const REMOVAL_WAITS_ON_ACTIVATION: &str =
    "nixmac will remove the unattended sync helper when the running activation finishes.";

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
    observe_ordered(app).0
}

/// [`observe`], with the pass's place in the order of finished passes (see
/// `reconcile::take_pass_order`). `None` for a `Busy` observation.
///
/// The report is recorded in the presentation state by the pass itself,
/// before it gives up the reconciliation slot, under the generation the
/// observation began in. Passes hold the slot one at a time, so the
/// presentation state receives reports in the order the passes ran: an
/// observation cannot be recorded after the action that followed it, nor a
/// failed action after the observation that found what it left behind.
pub(crate) fn observe_ordered<R: Runtime>(app: &AppHandle<R>) -> (Reconciled, Option<u64>) {
    let generation = PRESENTATION.generation();
    let report = reconcile::reconcile(&LiveEnvironment::new(app), |report, order| {
        PRESENTATION.note_report(report, generation, Some(order));
    });
    (report, reconcile::take_pass_order())
}

/// An observation recorded after it returns, with whatever order the test
/// gives it. Production records inside the pass ([`observe_ordered`]) and so
/// always in order; this is how the tests exercise the refusal of an older
/// report that the presentation state keeps as a second line of defence.
#[cfg(test)]
fn observe_ordered_with(
    presentation: &FailurePresentation,
    observe: impl FnOnce() -> (Reconciled, Option<u64>),
) -> (Reconciled, Option<u64>) {
    let generation = presentation.generation();
    let (report, order) = observe();
    presentation.note_report(&report, generation, order);
    (report, order)
}

/// An observation with no pass order, as the loop tests simulate one.
#[cfg(test)]
fn observe_with(
    presentation: &FailurePresentation,
    observe: impl FnOnce() -> Reconciled,
) -> Reconciled {
    observe_ordered_with(presentation, || (observe(), None)).0
}

/// Publishes the report of an explicit action's own pass as the helper row.
///
/// The click's caller refreshes right after the action returns, but that
/// refresh usually finds the convergence loop holding the reconciliation slot
/// and learns nothing (`Busy`). Without this the row would keep describing the
/// world before the click until the loop's first pass published, and a pass
/// that stopped short of a missing registration would never be shown at all:
/// the loop only observes, and reports that as `RegistrationUnavailable`.
///
/// `order` is the pass's place among finished passes. The state cell refuses a
/// row older than the one it holds, so this never lands on top of a report
/// from a pass that finished later.
fn publish_action_report<R: Runtime>(app: &AppHandle<R>, report: &Reconciled, order: Option<u64>) {
    permissions_state::replace_helper_row(
        app,
        permissions::helper_row(report, removing(app)),
        order,
    );
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
    let report = reconcile::grant(&LiveEnvironment::new(app), |report, order| {
        PRESENTATION.note_action_report(report, generation, Some(order), false);
    });
    let order = reconcile::take_pass_order();
    if !awaiting_approval_already && matches!(report, Reconciled::PendingApproval) {
        service::open_login_items_settings();
    }
    publish_action_report(app, &report, order);
    start_converging(app);
    report
}

/// Retry the stored decision without recording a new one or opening System
/// Settings.
///
/// This is deliberately separate from [`grant`]: a failed, already-enabled
/// helper needs another reconciliation attempt, not another opt-in action. A
/// stored Enable retries as an explicit Enable, so a missing registration gets
/// exactly one new register; a stored Disable retries the removal; an undecided
/// user is handled exactly like an observation, including its adoption of a
/// registration that already exists (see [`reconcile::retry`]). When an Enable
/// retry ends at approval, the row's deep link is the way to Login Items.
pub fn retry<R: Runtime>(app: &AppHandle<R>) -> Reconciled {
    let generation = PRESENTATION.begin_user_attempt();
    // This is an explicit, bounded retry whose progress the button showed. If
    // its pass still stops, the failure is shown at once (the `true`), keeping
    // recovery available rather than leaving a spinner up until the slow
    // background cadence wakes again.
    let report = reconcile::retry(&LiveEnvironment::new(app), |report, order| {
        PRESENTATION.note_action_report(report, generation, Some(order), true);
    });
    let order = reconcile::take_pass_order();
    publish_action_report(app, &report, order);
    start_converging(app);
    report
}

/// The explicit Disable action: record the decision, then reconcile under it —
/// unregister the helper, deferring while an activation runs, done. Never on
/// the main thread, for [`grant`]'s reason.
pub fn disable<R: Runtime>(app: &AppHandle<R>) -> Reconciled {
    let generation = PRESENTATION.begin_user_attempt();
    let report = reconcile::disable(&LiveEnvironment::new(app), |report, order| {
        PRESENTATION.note_action_report(report, generation, Some(order), false);
    });
    let order = reconcile::take_pass_order();
    publish_action_report(app, &report, order);
    start_converging(app);
    report
}

/// Whether the stored decision is Disable, so a pass still in progress, waiting,
/// or failed is about removing the helper rather than setting it up. An
/// unreadable decision reads as not removing; the report says why it stopped.
pub(crate) fn removing<R: Runtime>(app: &AppHandle<R>) -> bool {
    matches!(
        preferences::read_helper_preference(app),
        Ok(HelperPreference::Disabled)
    )
}

/// The permission row for one report: only a helper of this build, ready, is
/// granted, and every report says what it found. `removing` is [`removing`]'s
/// answer for the decision the report was produced under: progress, waiting
/// and failure copy then describe the removal.
pub fn row(
    report: &Reconciled,
    removing: bool,
) -> (PermissionStatus, String, HelperPermissionPhase) {
    row_with_failure_visibility(report, removing, PRESENTATION.failure_visible())
}

fn row_with_failure_visibility(
    report: &Reconciled,
    removing: bool,
    stopped_failure_visible: bool,
) -> (PermissionStatus, String, HelperPermissionPhase) {
    let status = match report {
        Reconciled::AtThisBuild => PermissionStatus::Granted,
        Reconciled::RegistrationUnavailable => PermissionStatus::Unknown,
        _ => PermissionStatus::Pending,
    };
    let phase = phase_with_failure_visibility(report, stopped_failure_visible);
    let detail = match phase {
        // A missing registration is a failure with a specific remedy: one
        // explicit retry, which may still end at macOS approval. Once an
        // explicit attempt has failed in this window, though, "retry enabling
        // it" is what the user just did: the observation that follows a failed
        // register reports the registration missing, and repeating that advice
        // would hide that the attempt failed. Say so, and offer the report
        // route, as for any other failed update.
        HelperPermissionPhase::Failed
            if matches!(report, Reconciled::RegistrationUnavailable)
                && !stopped_failure_visible =>
        {
            describe(report)
        }
        HelperPermissionPhase::Reconciling if removing => REMOVING.to_string(),
        HelperPermissionPhase::Reconciling => FINISHING_SETUP.to_string(),
        HelperPermissionPhase::Failed if removing => REMOVAL_FAILED.to_string(),
        HelperPermissionPhase::Failed => HELPER_UPDATE_FAILED.to_string(),
        HelperPermissionPhase::WaitingForActivation if removing => {
            REMOVAL_WAITS_ON_ACTIVATION.to_string()
        }
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
///
/// `removing` is [`removing`]'s answer for the decision the report was produced
/// under, so progress and waiting describe the removal, as [`row`] does.
pub fn action_detail(report: &Reconciled, removing: bool) -> String {
    match report {
        Reconciled::Stopped(_) => ACTION_FAILED.to_string(),
        Reconciled::Busy if removing => REMOVING.to_string(),
        Reconciled::WaitingOnActivation(_) if removing => REMOVAL_WAITS_ON_ACTIVATION.to_string(),
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
        // Final for the loop, and never retried by observation: the row
        // offers Retry, which runs an explicit Enable under the stored
        // decision. Failed regardless of the display window, because no
        // later pass will change it.
        Reconciled::RegistrationUnavailable => HelperPermissionPhase::Failed,
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
/// [`loop_step`], which classifies those as settled for that reason). What
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
        Reconciled::RegistrationUnavailable => {
            "macOS cannot find the helper registration. Retry enabling it; macOS may still require your approval.".to_string()
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
    /// Explicit actions whose pass has finished. With `generation` it forms
    /// the loop's staleness check (see [`FailurePresentation::action_epoch`]).
    finished_actions: u64,
    failure_visible: bool,
    /// A pass stopped short since the last report that settled cleanly or the
    /// last new attempt. A missing registration reported after that is the
    /// outcome of a failed attempt, not a first sighting.
    stopped_short: bool,
    /// The order of the newest pass recorded here (see
    /// `reconcile::take_pass_order`). Passes record themselves before giving
    /// up the reconciliation slot, so reports arrive in this order; one that
    /// did not is refused.
    newest_order: u64,
    last_failure_detail: Option<String>,
}

static PRESENTATION: FailurePresentation = FailurePresentation {
    state: Mutex::new(FailurePresentationState {
        generation: 0,
        finished_actions: 0,
        failure_visible: false,
        stopped_short: false,
        newest_order: 0,
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

    /// Changes whenever an explicit action begins or its pass finishes.
    ///
    /// The loop reads it before a pass and again before and after publishing.
    /// A change means an action's pass overlapped this one, so this report may
    /// describe the world before that action even when both ran under the same
    /// generation: an action takes its generation before it waits for the
    /// reconciliation slot, and a loop pass that starts in that wait can run
    /// first and still publish last.
    fn action_epoch(&self) -> (u64, u64) {
        let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        (state.generation, state.finished_actions)
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
        state.stopped_short = false;
        state.generation
    }

    /// Shows a failure whatever was recorded last: how the tests stage one.
    /// Production shows a failure only in the step that records a stopped
    /// Retry ([`Self::note_action_report`]) or while a stopped pass still
    /// stands ([`Self::show_standing_failure`]).
    #[cfg(test)]
    fn show_failure(&self, generation: u64) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if state.generation == generation {
            state.failure_visible = true;
        }
    }

    /// Shows the failure for the loop, which calls this after its pass has
    /// given up the reconciliation slot: by then a later pass may have settled
    /// cleanly, and a failure shown over that would outlive it (a missing
    /// registration reported next would read as a failed attempt). So this
    /// shows the failure only while a stopped pass is still what stands.
    fn show_standing_failure(&self, generation: u64) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if state.generation == generation && state.stopped_short {
            state.failure_visible = true;
        }
    }

    /// Records a report with no pass order: always applied when it belongs to
    /// the current generation. Production always has an order or an epoch;
    /// this is how the tests stage a state.
    #[cfg(test)]
    fn note_settled_report(&self, report: &Reconciled, generation: u64) {
        self.note_report(report, generation, None);
    }

    /// Records a report from the pass that finished `order`-th. Every pass
    /// calls this (or [`Self::note_action_report`]) before it gives up the
    /// reconciliation slot, so reports reach this lock in pass order. A report
    /// older than the newest one recorded is refused all the same: applying
    /// it would let an observation from before an action clear the failure
    /// that action recorded, even inside the action's own generation.
    fn note_report(&self, report: &Reconciled, generation: u64, order: Option<u64>) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        Self::apply(&mut state, report, generation, order);
    }

    /// Records the report of an explicit action's own pass and, in the same
    /// step, that the pass has finished (see [`Self::action_epoch`]). One step
    /// so the loop's check-and-record in [`Self::note_loop_report`] sees
    /// either neither or both.
    ///
    /// `show_stopped` shows the failure at once when this report stopped short
    /// and was recorded (a Retry's pass; see [`retry`]). The same step again,
    /// so no other report can land between the record and the flag.
    fn note_action_report(
        &self,
        report: &Reconciled,
        generation: u64,
        order: Option<u64>,
        show_stopped: bool,
    ) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        state.finished_actions = state.finished_actions.wrapping_add(1);
        let recorded = Self::apply(&mut state, report, generation, order);
        if recorded && show_stopped && matches!(report, Reconciled::Stopped(_)) {
            state.failure_visible = true;
        }
    }

    /// Records the report the loop is about to publish, unless an action began
    /// or finished since the pass started. The check and the update are one
    /// step under the lock, so the loop cannot record an overtaken report in
    /// the gap after its own staleness check.
    ///
    /// `order_before` is [`Self::newest_order`] as read when the pass began.
    /// The loop's observation normally records itself, with its order, before
    /// the loop gets here, and then this is a duplicate that must not run: by
    /// now a later pass (a refresh, say) may have recorded something newer,
    /// and replaying the loop's report would undo it. So this applies only
    /// when nothing ordered was recorded since the pass began.
    fn note_loop_report(&self, report: &Reconciled, attempt_epoch: (u64, u64), order_before: u64) {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if (state.generation, state.finished_actions) != attempt_epoch
            || state.newest_order != order_before
        {
            return;
        }
        Self::apply(&mut state, report, attempt_epoch.0, None);
    }

    fn newest_order(&self) -> u64 {
        self.state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .newest_order
    }

    /// Whether the report was recorded.
    fn apply(
        state: &mut FailurePresentationState,
        report: &Reconciled,
        generation: u64,
        order: Option<u64>,
    ) -> bool {
        if state.generation != generation || matches!(report, Reconciled::Busy) {
            return false;
        }
        if let Some(order) = order {
            if order <= state.newest_order {
                return false;
            }
            state.newest_order = order;
        }
        match report {
            Reconciled::Stopped(_) => {
                state.last_failure_detail = Some(describe(report));
                state.stopped_short = true;
            }
            // The pass that found the registration missing carries no error of
            // its own. Keep the register error that usually precedes it.
            Reconciled::RegistrationUnavailable => {
                if state.last_failure_detail.is_none() {
                    state.last_failure_detail = Some(describe(report));
                }
                // No later pass registers a missing helper, so an attempt that
                // stopped short and left the registration missing has failed
                // for good. Show that now, whatever the display window says:
                // an Enable whose register was refused must not be answered
                // with "retry enabling it" as if nothing had been tried.
                if state.stopped_short {
                    state.failure_visible = true;
                }
            }
            _ => {
                state.last_failure_detail = None;
                state.failure_visible = false;
                state.stopped_short = false;
            }
        }
        true
    }
}

fn should_show_failure(elapsed: Duration, working: u32) -> bool {
    elapsed >= FAILURE_PRESENTATION_AFTER || working >= MAX_ATTEMPTS
}

/// What the loop does with one report. Exhaustive on purpose: a new report
/// variant has to be classified here before it compiles, rather than falling
/// into the working counter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LoopStep {
    /// The observation lost the single-flight race and learned nothing.
    Lost,
    /// Nothing more for this loop to do.
    Settled,
    /// A wait that attempted nothing: approval, or a running activation.
    Waiting,
    /// A pass that stopped short and counts toward the mutation bound.
    Working,
}

fn loop_step(report: &Reconciled) -> LoopStep {
    match report {
        Reconciled::Busy => LoopStep::Lost,
        // The stored decision is carried out — one success state per goal.
        Reconciled::AtThisBuild | Reconciled::Removed | Reconciled::NoHelper
        // Or nothing this loop can do will change the answer. A displaced copy
        // must be moved or restarted, and neither takes effect in a running
        // process: `current_exe` reports the path the process was launched from,
        // and the realistic route here is a quarantined copy, which macOS runs
        // from a read-only mount that is never under /Applications. A broken
        // service definition is a property of the bundle, read identically every
        // time. A missing registration needs an explicit Enable or Retry, which
        // observation never replays.
        | Reconciled::Displaced(_)
        | Reconciled::ServiceDefinitionBroken
        | Reconciled::RegistrationUnavailable => LoopStep::Settled,
        Reconciled::PendingApproval | Reconciled::WaitingOnActivation(_) => LoopStep::Waiting,
        Reconciled::Stopped(_) => LoopStep::Working,
    }
}

/// The one loop, as a flag rather than a handle: nothing waits on it, cancels
/// it, or asks it anything.
static CONVERGING: AtomicBool = AtomicBool::new(false);

/// A start request that no loop has served yet. Set before every claim
/// attempt, so a request refused because a loop is still running is not lost:
/// that loop, after releasing [`CONVERGING`], sees it and runs again.
static START_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Held for a loop's lifetime, and released by `Drop` on every way out
/// including a panic — a leaked flag is permanent, since nothing else clears it.
///
/// Built only by [`claim`], and only after its compare-exchange succeeded. An
/// earlier version passed a guard into `bool::then_some`, which evaluates its
/// argument eagerly: the guard was built and dropped on the *refused* path too,
/// releasing the running loop's flag, and loops doubled every tick until the
/// process ran out of threads. `Option::map` runs its closure only on success.
struct Converging<'a>(&'a AtomicBool);

impl Drop for Converging<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn claim(running: &AtomicBool) -> Option<Converging<'_>> {
    running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .ok()
        .map(|_| Converging(running))
}

/// Records a start request, then tries to claim the loop. `None` means a loop
/// is running and will serve the request when it ends.
fn request_loop<'a>(running: &'a AtomicBool, requested: &AtomicBool) -> Option<Converging<'a>> {
    requested.store(true, Ordering::SeqCst);
    claim(running)
}

/// Runs the loop until no start request is left unserved.
///
/// `converge` runs one loop and calls the acknowledgement it is given at the
/// start of every pass: a pass that begins after a request serves it, so a
/// request only causes another loop when it arrived after the last pass began.
/// A refresh early in a long loop therefore cannot buy a second attempt budget.
///
/// The exit releases the claim before it reads `requested`, and a request sets
/// `requested` before it tries to claim. With both sequentially consistent, a
/// request either claims the released flag itself or is seen here, so none is
/// dropped between a loop's last check and its exit. `released` is a test seam
/// for that window and does nothing in production.
fn serve_requests(
    mut held: Converging<'_>,
    requested: &AtomicBool,
    mut converge: impl FnMut(&dyn Fn()),
    mut released: impl FnMut(),
) {
    let acknowledge = || requested.store(false, Ordering::SeqCst);
    loop {
        acknowledge();
        converge(&acknowledge);
        let running = held.0;
        drop(held);
        released();
        if !requested.load(Ordering::SeqCst) {
            return;
        }
        // A request arrived while this loop ran or as it ended. Run again,
        // unless that request's caller already claimed a loop of its own.
        match claim(running) {
            Some(reclaimed) => held = reclaimed,
            None => return,
        }
    }
}

/// Starts a loop unless one is already running.
///
/// Startup calls this, and so does every explicit user action. It continues
/// observing approval and registered-helper replacement. A missing registration
/// ends the loop and needs another explicit Enable, including after a crash
/// between unregister and register; an uncertain registration is never replayed.
/// A loop already running needs no new thread: every pass re-reads the stored
/// decision, so it picks up a Grant or a Disable by itself, and a request it
/// refused makes it run again once it ends ([`serve_requests`]).
pub fn start_converging<R: Runtime>(app: &AppHandle<R>) {
    // A build that reports every permission granted without probing must not go
    // and register a real helper behind that fiction. `replace_row` refuses too,
    // but this is the one that keeps `SMAppService` untouched.
    if permissions::skip_enabled() {
        return;
    }
    // Moved into the closure, so a `spawn` that fails drops it and gives the
    // flag back.
    let Some(guard) = request_loop(&CONVERGING, &START_REQUESTED) else {
        return;
    };
    let app = app.clone();
    // Off the calling thread for two reasons. It must not be the main thread:
    // the ServiceManagement calls are issued *on* the main queue and awaited, so
    // a main-thread caller would starve the queue it is waiting on, and the
    // adapter refuses outright. And its own thread rather than the blocking
    // pool, because this one sleeps for as long as an approval takes — a pool
    // slot it would never give back.
    std::thread::spawn(move || {
        // Where each pass's report stands among finished passes. `drive`
        // skips a report when an action began or finished during its pass, but
        // a pass can also finish before an action's and only get to publish
        // after it. The state cell refuses a row older than the one it holds,
        // so the order of publication never decides which row stays.
        let pass_order = std::cell::Cell::new(None);
        serve_requests(
            guard,
            &START_REQUESTED,
            |acknowledge| {
                drive(
                    &PRESENTATION,
                    || {
                        // This pass serves every start request made so far.
                        acknowledge();
                        let (report, order) = observe_ordered(&app);
                        pass_order.set(order);
                        report
                    },
                    |report| {
                        permissions_state::replace_helper_row(
                            &app,
                            permissions::helper_row(report, removing(&app)),
                            pass_order.get(),
                        );
                    },
                    std::thread::sleep,
                );
            },
            || {},
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
        // The generation this pass runs under. A newer user action changes it,
        // and starts a fresh display window here on the next pass.
        let attempt_generation = presentation.generation();
        // What the staleness checks below compare against: it also changes
        // when an action's pass finishes, which the generation alone misses.
        let attempt_epoch = presentation.action_epoch();
        let order_before = presentation.newest_order();
        if attempt_generation != user_generation {
            user_generation = attempt_generation;
            presentation_started = Some(now());
        } else if presentation_started.is_none() && !presentation.failure_visible() {
            presentation_started = Some(now());
        }

        let report = attempt();
        let step = loop_step(&report);

        // Busy says only that this observation lost the single-flight race. It
        // must not replace an approval, failure, or actionable instruction.
        if step == LoopStep::Lost {
            wait(WAITING_INTERVAL);
            continue;
        }

        // A user action began or finished during this pass, so this report may
        // describe the world before that action, which has since run (or is
        // waiting to run) a pass of its own under the slot. Publishing it could put a
        // Ready row over a Disable that has since failed, and ending here would
        // strand that action: `start_converging` refuses while this loop runs,
        // so the action relies on this loop for its retries. Skip the report and
        // observe again; the top of the loop starts the newer attempt's display
        // window. A stale pass that stopped short still counts toward the
        // mutation bound, since it may have mutated.
        if presentation.action_epoch() != attempt_epoch {
            if step == LoopStep::Working {
                working += 1;
            }
            wait(FAST_INTERVAL);
            continue;
        }

        if step == LoopStep::Settled {
            presentation.note_loop_report(&report, attempt_epoch, order_before);
            publish(&report);
            // An action that began while this published gets a pass too, for
            // the reason above, instead of an exit that strands it.
            if presentation.action_epoch() == attempt_epoch {
                return;
            }
            continue;
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
        if step == LoopStep::Waiting {
            // This is a genuine wait boundary, not another failed mutation.
            // Give the work after it a fresh *display* window while leaving the
            // lifetime `working` safety counter untouched.
            presentation_started = None;
            presentation.note_loop_report(&report, attempt_epoch, order_before);
            publish(&report);
            // An action that began while this published has run, or is about
            // to run, a pass of its own. Observe again now instead of leaving
            // this older row up for the whole wait.
            if presentation.action_epoch() != attempt_epoch {
                continue;
            }
            wait(WAITING_INTERVAL);
            continue;
        }

        // Every other step continued or returned above.
        debug_assert_eq!(step, LoopStep::Working, "{report:?}");
        working += 1;
        let elapsed = presentation_started
            .map(|started| now().saturating_duration_since(started))
            .unwrap_or_default();
        presentation.note_loop_report(&report, attempt_epoch, order_before);
        if should_show_failure(elapsed, working) {
            presentation.show_standing_failure(attempt_generation);
        }
        publish(&report);

        if working >= MAX_ATTEMPTS {
            log::warn!(
                "helper convergence: giving up after {working} attempts, last report {report:?}; \
                 repair is left to the next launch or user action"
            );
            return;
        }
        // As in the waiting arm: an action that began while this published
        // gets its pass now, not after the retry spacing.
        if presentation.action_epoch() != attempt_epoch {
            continue;
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

    fn activation_info() -> crate::privileged_helper::protocol::ActivationInfo {
        crate::privileged_helper::protocol::ActivationInfo {
            request_id: "request".to_string(),
            script_path: "/nix/store/abc-darwin-system/activate".to_string(),
            client_kind: crate::privileged_helper::peer_auth::ClientKind::SyncAgent,
        }
    }

    fn displaced() -> Reconciled {
        Reconciled::Displaced(
            "nixmac is not running from an app bundle in /Applications".to_string(),
        )
    }

    #[test]
    fn unavailable_registration_offers_explicit_retry_without_claiming_permission() {
        for failure_visible in [false, true] {
            assert_eq!(
                phase_with_failure_visibility(
                    &Reconciled::RegistrationUnavailable,
                    failure_visible
                ),
                HelperPermissionPhase::Failed,
                "the row must offer Retry whatever the display window says"
            );
        }
        let (status, detail, phase) = row(&Reconciled::RegistrationUnavailable, false);
        assert_eq!(status, PermissionStatus::Unknown);
        assert_eq!(phase, HelperPermissionPhase::Failed);
        assert!(detail.contains("Retry enabling"));
        assert!(
            action_detail(&Reconciled::RegistrationUnavailable, false).contains("Retry enabling")
        );

        let mut observations = 0;
        let mut published = Vec::new();
        drive(
            &FailurePresentation::default(),
            || {
                observations += 1;
                Reconciled::RegistrationUnavailable
            },
            |report| published.push(report.clone()),
            |_| panic!("an unavailable registration must not schedule another attempt"),
        );
        assert_eq!(observations, 1);
        assert_eq!(published, vec![Reconciled::RegistrationUnavailable]);
    }

    #[test]
    fn a_stored_disable_describes_the_removal_in_progress_waiting_and_failed() {
        let refused = stopped("the helper could not be unregistered: refused");
        let removal =
            |report: &Reconciled, visible| row_with_failure_visibility(report, true, visible);

        let (_, detail, phase) = removal(&refused, false);
        assert_eq!(phase, HelperPermissionPhase::Reconciling);
        assert_eq!(detail, REMOVING);

        let (_, detail, phase) = removal(&refused, true);
        assert_eq!(phase, HelperPermissionPhase::Failed);
        assert_eq!(detail, REMOVAL_FAILED);

        for waiting in [
            Reconciled::WaitingOnActivation(None),
            Reconciled::WaitingOnActivation(Some(activation_info())),
        ] {
            let (_, detail, phase) = removal(&waiting, false);
            assert_eq!(phase, HelperPermissionPhase::WaitingForActivation);
            assert_eq!(detail, REMOVAL_WAITS_ON_ACTIVATION);
        }

        // The setup copy stays for an Enable.
        let (_, detail, _) = row_with_failure_visibility(&refused, false, false);
        assert_eq!(detail, FINISHING_SETUP);
        let (_, detail, _) = row_with_failure_visibility(&refused, false, true);
        assert_eq!(detail, HELPER_UPDATE_FAILED);
        for copy in [REMOVING, REMOVAL_FAILED, REMOVAL_WAITS_ON_ACTIVATION] {
            assert!(
                !copy.contains("setup") && !copy.contains("update"),
                "{copy}"
            );
        }
    }

    #[test]
    fn a_start_request_refused_while_a_loop_ends_makes_it_run_again() {
        // The lost wakeup: the loop has made its final check, a Disable then
        // fails and asks for a loop, and is refused because this one still
        // holds the flag. The request must not die with the old loop.
        let running = AtomicBool::new(false);
        let requested = AtomicBool::new(false);
        let held = request_loop(&running, &requested).expect("a free flag");
        let mut passes = 0;
        serve_requests(
            held,
            &requested,
            |acknowledge| {
                acknowledge();
                passes += 1;
                if passes == 1 {
                    assert!(
                        request_loop(&running, &requested).is_none(),
                        "a second loop claimed a taken flag"
                    );
                }
            },
            || {},
        );
        assert_eq!(passes, 2, "the refused request was never served");
        assert!(!running.load(Ordering::SeqCst));
        assert!(!requested.load(Ordering::SeqCst));
    }

    #[test]
    fn a_start_request_refused_mid_loop_is_served_without_a_second_attempt_budget() {
        // A refresh asks for a loop early in a long run of failures. A later
        // pass of the same loop serves it, so the loop still gives up after
        // one MAX_ATTEMPTS budget rather than starting another.
        let running = AtomicBool::new(false);
        let requested = AtomicBool::new(false);
        let held = request_loop(&running, &requested).expect("a free flag");
        let attempts = std::cell::Cell::new(0);
        serve_requests(
            held,
            &requested,
            |acknowledge| {
                drive(
                    &FailurePresentation::default(),
                    || {
                        acknowledge();
                        attempts.set(attempts.get() + 1);
                        if attempts.get() == 1 {
                            assert!(request_loop(&running, &requested).is_none());
                        }
                        stopped("the helper could not be registered: not permitted")
                    },
                    |_| {},
                    |_| {},
                );
            },
            || {},
        );
        assert_eq!(attempts.get(), MAX_ATTEMPTS);
        assert!(!running.load(Ordering::SeqCst));
    }

    #[test]
    fn a_start_request_in_the_release_window_starts_its_own_loop() {
        // The request lands after the old loop released the flag but before
        // it read the request: the request's own claim succeeds, and the old
        // loop leaves the work to it rather than running a second loop.
        let running = AtomicBool::new(false);
        let requested = AtomicBool::new(false);
        let held = request_loop(&running, &requested).expect("a free flag");
        let mut passes = 0;
        let mut theirs = None;
        serve_requests(
            held,
            &requested,
            |acknowledge| {
                acknowledge();
                passes += 1;
            },
            || {
                if theirs.is_none() {
                    theirs = Some(request_loop(&running, &requested));
                }
            },
        );
        assert_eq!(passes, 1);
        let theirs = theirs
            .expect("the window ran")
            .expect("the request claimed the free flag");
        assert!(
            running.load(Ordering::SeqCst),
            "only the new loop holds the flag"
        );
        drop(theirs);
        assert!(!running.load(Ordering::SeqCst));
    }

    #[test]
    fn a_loop_with_no_request_left_exits_and_releases_the_flag() {
        let running = AtomicBool::new(false);
        let requested = AtomicBool::new(false);
        let held = request_loop(&running, &requested).expect("a free flag");
        let mut passes = 0;
        serve_requests(
            held,
            &requested,
            |acknowledge| {
                acknowledge();
                passes += 1;
            },
            || {},
        );
        assert_eq!(passes, 1);
        assert!(!running.load(Ordering::SeqCst));
        assert!(claim(&running).is_some());
    }

    #[test]
    fn every_report_has_exactly_one_loop_step() {
        for (report, expected) in [
            (Reconciled::Busy, LoopStep::Lost),
            (Reconciled::AtThisBuild, LoopStep::Settled),
            (Reconciled::Removed, LoopStep::Settled),
            (Reconciled::NoHelper, LoopStep::Settled),
            (displaced(), LoopStep::Settled),
            (Reconciled::ServiceDefinitionBroken, LoopStep::Settled),
            (Reconciled::RegistrationUnavailable, LoopStep::Settled),
            (Reconciled::PendingApproval, LoopStep::Waiting),
            (Reconciled::WaitingOnActivation(None), LoopStep::Waiting),
            (
                stopped("the helper could not be registered"),
                LoopStep::Working,
            ),
        ] {
            assert_eq!(loop_step(&report), expected, "{report:?}");
        }
    }

    #[test]
    fn a_missing_registration_keeps_the_register_error_for_feedback() {
        let presentation = FailurePresentation::default();
        let attempt = presentation.begin_user_attempt();
        presentation.note_settled_report(
            &stopped("the helper could not be registered: SMAppServiceErrorDomain 1"),
            attempt,
        );
        presentation.note_settled_report(&Reconciled::RegistrationUnavailable, attempt);
        assert!(
            presentation
                .last_failure_detail()
                .unwrap()
                .contains("SMAppServiceErrorDomain 1")
        );

        let fresh = FailurePresentation::default();
        let attempt = fresh.begin_user_attempt();
        fresh.note_settled_report(&Reconciled::RegistrationUnavailable, attempt);
        assert!(
            fresh
                .last_failure_detail()
                .unwrap()
                .contains("cannot find the helper registration")
        );
        fresh.note_settled_report(&Reconciled::AtThisBuild, attempt);
        assert!(fresh.last_failure_detail().is_none());
    }

    #[test]
    fn the_loop_stops_on_a_goal_and_on_nothing_else_it_can_fix() {
        for done in [
            Reconciled::AtThisBuild,
            Reconciled::Removed,
            Reconciled::NoHelper,
            displaced(),
            Reconciled::ServiceDefinitionBroken,
            Reconciled::RegistrationUnavailable,
        ] {
            assert_eq!(loop_step(&done), LoopStep::Settled, "{done:?}");
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
            assert_ne!(loop_step(&keep_going), LoopStep::Settled, "{keep_going:?}");
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
            Reconciled::RegistrationUnavailable,
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
            (
                Reconciled::RegistrationUnavailable,
                HelperPermissionPhase::Failed,
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
        assert!(!action_detail(&report, false).contains("SMAppServiceErrorDomain"));
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
        assert!(!action_detail(&failure, false).contains("SMAppServiceErrorDomain"));
        presentation.note_settled_report(&Reconciled::Busy, first);
        assert!(presentation.last_failure_detail().is_some());

        let next = presentation.begin_user_attempt();
        presentation.note_settled_report(&Reconciled::AtThisBuild, first);
        assert!(presentation.last_failure_detail().is_some());
        presentation.note_settled_report(&Reconciled::AtThisBuild, next);
        assert!(presentation.last_failure_detail().is_none());
    }

    #[test]
    fn a_stale_ready_row_never_hides_a_newer_failed_action() {
        // The stale-Ready race, end to end: this loop's pass reached Ready and
        // released reconciliation's slot; a Disable then ran and failed before
        // the loop published. The old Ready row must never be published, and
        // the loop must not exit, because the Disable's own
        // `start_converging` was refused while this loop ran.
        //
        // The simulated Disable makes exactly the presentation calls
        // `disable` makes: a new attempt and its settled report. It does not
        // show the failure itself (only `retry` does that), so the failed
        // removal is first published inside its display window, as removal in
        // progress, and the loop keeps retrying it.
        let presentation = FailurePresentation::default();
        let attempts = std::cell::Cell::new(0);
        let mut published = Vec::new();
        let mut phases = Vec::new();
        let mut waited = Vec::new();
        let refused = stopped("the helper could not be unregistered: refused");
        drive(
            &presentation,
            || {
                attempts.set(attempts.get() + 1);
                match attempts.get() {
                    1 => observe_with(&presentation, || {
                        let disable = presentation.begin_user_attempt();
                        presentation.note_settled_report(&refused, disable);
                        Reconciled::AtThisBuild
                    }),
                    // The next pass observes the world the Disable left.
                    2 => refused.clone(),
                    _ => Reconciled::Removed,
                }
            },
            |report| {
                published.push(report.clone());
                phases.push(phase_with_failure_visibility(
                    report,
                    presentation.failure_visible(),
                ));
            },
            |interval| waited.push(interval),
        );
        assert_eq!(attempts.get(), 3, "the loop exited on the stale report");
        assert_eq!(published, vec![refused.clone(), Reconciled::Removed]);
        assert_eq!(
            phases,
            vec![
                HelperPermissionPhase::Reconciling,
                HelperPermissionPhase::Disabled
            ]
        );
        assert_eq!(waited[0], FAST_INTERVAL, "a stale report is not hurried");
    }

    #[test]
    fn a_retry_that_fails_while_a_stale_ready_row_is_pending_is_published_as_failed() {
        // The same race under Retry, which does show its own failure: the
        // stale Ready row is skipped and the retried removal is published as
        // failed at once, not after the display window.
        let presentation = FailurePresentation::default();
        let attempts = std::cell::Cell::new(0);
        let mut phases = Vec::new();
        let refused = stopped("the helper could not be unregistered: refused");
        drive(
            &presentation,
            || {
                attempts.set(attempts.get() + 1);
                match attempts.get() {
                    1 => observe_with(&presentation, || {
                        let retry = presentation.begin_user_attempt();
                        presentation.note_settled_report(&refused, retry);
                        presentation.show_failure(retry);
                        Reconciled::AtThisBuild
                    }),
                    2 => refused.clone(),
                    _ => Reconciled::Removed,
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
            vec![
                HelperPermissionPhase::Failed,
                HelperPermissionPhase::Disabled
            ]
        );
    }

    #[test]
    fn a_report_that_an_action_overtook_within_its_generation_is_not_published() {
        // A Retry takes its generation and then waits for the reconciliation
        // slot. A loop pass that starts in that wait runs under the Retry's
        // generation, can hold the slot first and fail, and then get to
        // publish only after the Retry has succeeded. Its report is the older
        // one although the generation never changed again; the loop must drop
        // it and observe again promptly, not publish it and sleep.
        let presentation = FailurePresentation::default();
        let retry = presentation.begin_user_attempt();
        let attempts = std::cell::Cell::new(0);
        let mut published = Vec::new();
        let mut waited = Vec::new();
        let refused = stopped("the helper could not be unregistered: refused");
        drive(
            &presentation,
            || {
                attempts.set(attempts.get() + 1);
                match attempts.get() {
                    1 => {
                        // The Retry's own pass ran after this one and settled.
                        presentation.note_action_report(
                            &Reconciled::Removed,
                            retry,
                            Some(2),
                            false,
                        );
                        refused.clone()
                    }
                    _ => Reconciled::Removed,
                }
            },
            |report| published.push(report.clone()),
            |interval| waited.push(interval),
        );
        assert_eq!(presentation.generation(), retry);
        assert_eq!(published, vec![Reconciled::Removed]);
        assert_eq!(waited, vec![FAST_INTERVAL]);
    }

    #[test]
    fn an_action_that_begins_while_a_waiting_row_publishes_is_observed_without_the_wait() {
        // The waiting arm publishes and then sleeps. An action that began in
        // between must not sit behind that sleep with the older row showing.
        let presentation = FailurePresentation::default();
        let attempts = std::cell::Cell::new(0);
        let mut published = Vec::new();
        let mut waited = Vec::new();
        drive(
            &presentation,
            || {
                attempts.set(attempts.get() + 1);
                match attempts.get() {
                    1 => Reconciled::PendingApproval,
                    _ => Reconciled::Removed,
                }
            },
            |report| {
                if matches!(report, Reconciled::PendingApproval) {
                    presentation.begin_user_attempt();
                }
                published.push(report.clone());
            },
            |interval| waited.push(interval),
        );
        assert_eq!(
            published,
            vec![Reconciled::PendingApproval, Reconciled::Removed]
        );
        assert!(waited.is_empty(), "the loop waited on a superseded row");
    }

    #[test]
    fn an_action_that_begins_while_a_working_row_publishes_is_observed_without_the_wait() {
        let presentation = FailurePresentation::default();
        let attempts = std::cell::Cell::new(0);
        let mut published = Vec::new();
        let mut waited = Vec::new();
        let refused = stopped("the helper could not be unregistered: refused");
        drive(
            &presentation,
            || {
                attempts.set(attempts.get() + 1);
                match attempts.get() {
                    1 => refused.clone(),
                    _ => Reconciled::Removed,
                }
            },
            |report| {
                if matches!(report, Reconciled::Stopped(_)) {
                    presentation.begin_user_attempt();
                }
                published.push(report.clone());
            },
            |interval| waited.push(interval),
        );
        assert_eq!(published, vec![refused.clone(), Reconciled::Removed]);
        assert!(waited.is_empty(), "the loop waited on a superseded row");
    }

    #[test]
    fn a_missing_registration_after_a_failed_attempt_says_the_attempt_failed() {
        // A Retry whose register fails leaves the registration missing, and
        // the observation that follows reports only that. With the failure
        // showing, the row must not repeat "retry enabling it".
        let (_, first_visit, phase) =
            row_with_failure_visibility(&Reconciled::RegistrationUnavailable, false, false);
        assert_eq!(phase, HelperPermissionPhase::Failed);
        assert!(first_visit.contains("Retry enabling"));

        let (status, after_failure, phase) =
            row_with_failure_visibility(&Reconciled::RegistrationUnavailable, false, true);
        assert_eq!(status, PermissionStatus::Unknown);
        assert_eq!(phase, HelperPermissionPhase::Failed);
        assert_eq!(after_failure, HELPER_UPDATE_FAILED);

        // The failure a Retry shows survives that observation.
        let presentation = FailurePresentation::default();
        let retry = presentation.begin_user_attempt();
        let failed = stopped("the helper could not be registered: refused");
        presentation.note_settled_report(&failed, retry);
        presentation.show_failure(retry);
        presentation.note_settled_report(&Reconciled::RegistrationUnavailable, retry);
        assert!(presentation.failure_visible());
    }

    #[test]
    fn an_enable_whose_register_failed_is_shown_as_failed_once_the_registration_is_missing() {
        // Enable does not show its own failure: a first Enable often stops
        // short while the helper starts, and the loop finishes it. But when
        // the register itself was refused, the registration is still missing,
        // the loop only observes, and its report is `RegistrationUnavailable`.
        // That row must say the attempt failed.
        let presentation = FailurePresentation::default();
        let enable = presentation.begin_user_attempt();
        let failed = stopped("the helper could not be registered: refused");
        presentation.note_settled_report(&failed, enable);
        assert!(!presentation.failure_visible(), "still inside the window");

        let mut rows = Vec::new();
        drive(
            &presentation,
            || Reconciled::RegistrationUnavailable,
            |report| {
                rows.push(row_with_failure_visibility(
                    report,
                    false,
                    presentation.failure_visible(),
                ));
            },
            |_| panic!("a missing registration is settled"),
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].2, HelperPermissionPhase::Failed);
        assert_eq!(rows[0].1, HELPER_UPDATE_FAILED);

        // A registration found missing with no failed attempt before it keeps
        // the specific advice, and so does the next attempt's clean slate.
        let fresh = FailurePresentation::default();
        fresh.note_settled_report(&Reconciled::RegistrationUnavailable, fresh.generation());
        assert!(!fresh.failure_visible());
        let next = presentation.begin_user_attempt();
        presentation.note_settled_report(&Reconciled::RegistrationUnavailable, next);
        assert!(!presentation.failure_visible());
    }

    #[test]
    fn an_observation_that_finished_before_an_enable_cannot_clear_its_failure() {
        // Enable takes its generation before it records Granted. An
        // observation that starts then still sees the earlier decision,
        // finishes with NoHelper (pass 1), and is paused before it records
        // that. Enable's register is refused (pass 2) and recorded first. The
        // older NoHelper shares Enable's generation, but must not clear the
        // failure: the next observation reports the registration missing, and
        // that row has to say the attempt failed and keep its diagnostic.
        let presentation = FailurePresentation::default();
        let enable = presentation.begin_user_attempt();
        let failed = stopped("the helper could not be registered: refused");

        let (overtaken, _) = observe_ordered_with(&presentation, || {
            presentation.note_action_report(&failed, enable, Some(2), false);
            (Reconciled::NoHelper, Some(1))
        });
        assert_eq!(overtaken, Reconciled::NoHelper);
        assert_eq!(
            presentation.last_failure_detail(),
            Some(describe(&failed)),
            "the older observation erased the register error"
        );

        observe_ordered_with(&presentation, || {
            (Reconciled::RegistrationUnavailable, Some(3))
        });
        assert!(presentation.failure_visible());
        let (_, detail, phase) = row_with_failure_visibility(
            &Reconciled::RegistrationUnavailable,
            false,
            presentation.failure_visible(),
        );
        assert_eq!(phase, HelperPermissionPhase::Failed);
        assert_eq!(detail, HELPER_UPDATE_FAILED);
        assert_eq!(presentation.last_failure_detail(), Some(describe(&failed)));
    }

    #[test]
    fn the_loop_does_not_record_a_report_an_action_overtook_before_publication() {
        // The loop checks for an overlapping action and then records its
        // report. An action that finishes in that gap must not have its
        // failure cleared by the loop's older report.
        let presentation = FailurePresentation::default();
        let retry = presentation.begin_user_attempt();
        let epoch = presentation.action_epoch();
        let failed = stopped("the helper could not be registered: refused");
        presentation.note_action_report(&failed, retry, Some(5), false);
        presentation.show_failure(retry);

        presentation.note_loop_report(&Reconciled::NoHelper, epoch, 0);
        assert!(presentation.failure_visible());
        assert_eq!(presentation.last_failure_detail(), Some(describe(&failed)));

        // A report from a pass that began after the action is recorded.
        presentation.note_loop_report(
            &Reconciled::AtThisBuild,
            presentation.action_epoch(),
            presentation.newest_order(),
        );
        assert!(!presentation.failure_visible());
        assert!(presentation.last_failure_detail().is_none());
    }

    #[test]
    fn a_report_older_than_the_newest_recorded_one_is_refused_whole() {
        // Passes record themselves before they give up the reconciliation
        // slot, so this does not happen in production (the reconciler's tests
        // pin that). The presentation state refuses it all the same, and
        // refuses all of it: an out-of-order report changes nothing, whatever
        // it says.
        let presentation = FailurePresentation::default();
        let attempt = presentation.begin_user_attempt();
        let failed = stopped("the helper could not be registered: refused");
        let unavailable = Reconciled::RegistrationUnavailable;
        presentation.note_report(&unavailable, attempt, Some(2));
        let epoch = presentation.action_epoch();

        presentation.note_action_report(&failed, attempt, Some(1), true);
        assert!(!presentation.failure_visible());
        assert_eq!(
            presentation.last_failure_detail(),
            Some(describe(&unavailable))
        );
        // The action still counts as finished for the loop's staleness check.
        assert_ne!(presentation.action_epoch(), epoch);

        presentation.note_report(&Reconciled::AtThisBuild, attempt, Some(1));
        assert_eq!(
            presentation.last_failure_detail(),
            Some(describe(&unavailable))
        );
    }

    #[test]
    fn a_retry_that_stops_short_is_shown_as_failed_in_the_step_that_records_it() {
        let failed = stopped("the helper could not be registered: refused");

        let presentation = FailurePresentation::default();
        let retry = presentation.begin_user_attempt();
        presentation.note_action_report(&failed, retry, Some(1), true);
        assert!(presentation.failure_visible());
        assert_eq!(presentation.last_failure_detail(), Some(describe(&failed)));

        // Enable and Disable leave the display window to the loop.
        let presentation = FailurePresentation::default();
        let enable = presentation.begin_user_attempt();
        presentation.note_action_report(&failed, enable, Some(1), false);
        assert!(!presentation.failure_visible());

        // A Retry that did not stop short shows nothing.
        let presentation = FailurePresentation::default();
        let retry = presentation.begin_user_attempt();
        presentation.note_action_report(&Reconciled::PendingApproval, retry, Some(1), true);
        assert!(!presentation.failure_visible());

        // Nor does one overtaken by a newer attempt.
        let presentation = FailurePresentation::default();
        let retry = presentation.begin_user_attempt();
        let newer = presentation.begin_user_attempt();
        presentation.note_action_report(&failed, retry, Some(1), true);
        assert!(!presentation.failure_visible());
        assert_ne!(retry, newer);
    }

    #[test]
    fn the_loop_does_not_replay_its_report_over_a_newer_recorded_one() {
        // No action involved: the loop's observation records PendingApproval
        // (pass 1), a refresh then records a pass that stopped short (pass 2),
        // and the loop reaches its own record afterwards. Replaying the older
        // PendingApproval would clear the newer failure.
        let presentation = FailurePresentation::default();
        let failed = stopped("the helper could not be registered: refused");
        let mut published = Vec::new();
        let attempts = std::cell::Cell::new(0);
        drive(
            &presentation,
            || {
                attempts.set(attempts.get() + 1);
                match attempts.get() {
                    1 => {
                        let generation = presentation.generation();
                        presentation.note_report(&Reconciled::PendingApproval, generation, Some(1));
                        presentation.note_report(&failed, generation, Some(2));
                        Reconciled::PendingApproval
                    }
                    _ => Reconciled::AtThisBuild,
                }
            },
            |report| {
                if matches!(report, Reconciled::PendingApproval) {
                    assert_eq!(
                        presentation.last_failure_detail(),
                        Some(describe(&failed)),
                        "the loop replayed its older report"
                    );
                }
                published.push(report.clone());
            },
            |_| {},
        );
        assert_eq!(
            published,
            vec![Reconciled::PendingApproval, Reconciled::AtThisBuild]
        );
    }

    #[test]
    fn the_loop_does_not_replay_a_settled_report_over_a_newer_recorded_one() {
        // The same at the loop's other record: its observation settles (pass
        // 1), a refresh records a pass that stopped short (pass 2), and the
        // loop then publishes and exits without undoing the newer record.
        let presentation = FailurePresentation::default();
        let failed = stopped("the helper could not be registered: refused");
        let mut published = Vec::new();
        drive(
            &presentation,
            || {
                let generation = presentation.generation();
                presentation.note_report(&Reconciled::AtThisBuild, generation, Some(1));
                presentation.note_report(&failed, generation, Some(2));
                Reconciled::AtThisBuild
            },
            |report| published.push(report.clone()),
            |_| {},
        );
        assert_eq!(published, vec![Reconciled::AtThisBuild]);
        assert_eq!(presentation.last_failure_detail(), Some(describe(&failed)));
    }

    #[test]
    fn the_loop_does_not_show_a_failure_over_a_newer_clean_report() {
        // The loop's pass stops short (pass 1) and a refresh then settles
        // cleanly (pass 2) before the loop decides to show the failure. The
        // bound is reached, so the loop would show it; nothing may be shown
        // over the newer clean report, or a missing registration reported
        // next would read as a failed attempt.
        let presentation = FailurePresentation::default();
        let failed = stopped("the helper did not answer");
        let attempts = std::cell::Cell::new(0);
        drive(
            &presentation,
            || {
                attempts.set(attempts.get() + 1);
                let generation = presentation.generation();
                let order = attempts.get() * 2;
                presentation.note_report(&failed, generation, Some(order - 1));
                presentation.note_report(&Reconciled::AtThisBuild, generation, Some(order));
                failed.clone()
            },
            |_| {},
            |_| {},
        );
        assert_eq!(attempts.get(), u64::from(MAX_ATTEMPTS));
        assert!(!presentation.failure_visible());
        assert!(presentation.last_failure_detail().is_none());
    }

    #[test]
    fn action_detail_describes_a_removal_under_a_stored_disable() {
        assert_eq!(action_detail(&Reconciled::Busy, true), REMOVING);
        assert_eq!(action_detail(&Reconciled::Busy, false), FINISHING_SETUP);
        assert_eq!(
            action_detail(&Reconciled::WaitingOnActivation(None), true),
            REMOVAL_WAITS_ON_ACTIVATION
        );
        assert!(
            action_detail(&Reconciled::WaitingOnActivation(None), false)
                .contains("before updating the unattended sync helper")
        );
    }

    #[test]
    fn a_stale_failure_from_before_a_retry_is_neither_published_nor_clears_it() {
        let presentation = FailurePresentation::default();
        let attempts = std::cell::Cell::new(0);
        let mut published = Vec::new();
        let mut phases = Vec::new();
        drive(
            &presentation,
            || {
                attempts.set(attempts.get() + 1);
                match attempts.get() {
                    1 => {
                        // The background pass releases reconciliation's slot,
                        // then Retry runs and fails before this loop publishes.
                        let retry = presentation.begin_user_attempt();
                        presentation.show_failure(retry);
                        stopped("the background pass could not register")
                    }
                    2 => {
                        assert!(
                            presentation.failure_visible(),
                            "the stale pass cleared Retry's failure"
                        );
                        stopped("the helper could not be registered")
                    }
                    _ => Reconciled::AtThisBuild,
                }
            },
            |report| {
                published.push(report.clone());
                phases.push(phase_with_failure_visibility(
                    report,
                    presentation.failure_visible(),
                ));
            },
            |_| {},
        );
        assert_eq!(
            published,
            vec![
                stopped("the helper could not be registered"),
                Reconciled::AtThisBuild
            ]
        );
        assert_eq!(
            phases,
            vec![HelperPermissionPhase::Failed, HelperPermissionPhase::Ready]
        );
    }

    #[test]
    fn an_action_that_begins_while_a_settled_row_publishes_gets_another_pass() {
        let presentation = FailurePresentation::default();
        let attempts = std::cell::Cell::new(0);
        let mut published = Vec::new();
        drive(
            &presentation,
            || {
                attempts.set(attempts.get() + 1);
                if attempts.get() == 1 {
                    Reconciled::AtThisBuild
                } else {
                    Reconciled::Removed
                }
            },
            |report| {
                if published.is_empty() {
                    // A Disable starts after the generation check but before
                    // this loop would have exited.
                    presentation.begin_user_attempt();
                }
                published.push(report.clone());
            },
            |_| {},
        );
        assert_eq!(attempts.get(), 2);
        assert_eq!(
            published,
            vec![Reconciled::AtThisBuild, Reconciled::Removed]
        );
    }

    #[test]
    fn a_stale_settled_observation_cannot_clear_a_newer_failed_retry() {
        let presentation = FailurePresentation::default();
        let attempts = std::cell::Cell::new(0);
        drive(
            &presentation,
            || {
                attempts.set(attempts.get() + 1);
                if attempts.get() == 1 {
                    observe_with(&presentation, || {
                        // This observation already obtained Ready and released
                        // the reconciliation slot. Retry acquires it and fails
                        // before the older observation returns.
                        let retry_generation = presentation.begin_user_attempt();
                        presentation.show_failure(retry_generation);
                        Reconciled::AtThisBuild
                    })
                } else {
                    assert!(
                        presentation.failure_visible(),
                        "observe() or drive() cleared Retry's failure with a stale report"
                    );
                    Reconciled::RegistrationUnavailable
                }
            },
            |report| assert_eq!(report, &Reconciled::RegistrationUnavailable),
            |_| {},
        );
        assert_eq!(attempts.get(), 2);
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
        // Note this drives `claim` and `Converging` directly, not
        // `start_converging` — the claim/spawn/guard *sequencing* in that
        // function is what once had the doubling bug, and it is not covered
        // here.
        let held = claim(&CONVERGING).expect("a free flag");
        assert!(
            claim(&CONVERGING).is_none(),
            "a second loop claimed a taken flag"
        );
        // A refused claim must not release what the holder has — the bug that
        // spawned loops until the process ran out of threads.
        assert!(CONVERGING.load(Ordering::SeqCst));
        drop(held);

        let outcome = std::panic::catch_unwind(|| {
            let _guard = claim(&CONVERGING).expect("a free flag");
            panic!("the run panicked");
        });
        assert!(outcome.is_err());
        assert!(
            !CONVERGING.load(Ordering::SeqCst),
            "the flag was leaked by a panic"
        );
    }
}
