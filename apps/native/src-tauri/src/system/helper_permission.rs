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
    self, Environment, LiveEnvironment, PeerReply, Reconciled,
};
use crate::privileged_helper::service::{
    self, RegisterFailure, RegistrationStatus, ReplaceFailure,
};
use crate::privileged_helper::socket_probe::ListenerObservation;
use crate::shared_types::{HelperDecision, HelperPreference, PermissionStatus};
use crate::system::install_location::InstallLocation;

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
    reconcile::disable(&GuiEnvironment::new(app))
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
