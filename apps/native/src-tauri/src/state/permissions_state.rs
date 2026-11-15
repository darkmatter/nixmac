//! Last-known macOS permissions — an in-memory mirror of probe results.
//!
//! The OS is the source of truth and probing can trigger permission prompts,
//! so the cell is NOT persisted and getters never probe: [`refresh`] is the
//! explicit probe-and-record entry point, `None` means "never probed since
//! startup".

use std::sync::{Mutex, PoisonError};

use tauri::{AppHandle, Manager, Runtime};

use crate::observable::Observable;
use crate::shared_types::{Permission, PermissionStatus, PermissionsState};
use crate::system::permissions;

pub const PERMISSIONS_CHANGED_EVENT: &str = "permissions_changed";

pub fn load_observable<R: Runtime>(app: &AppHandle<R>) -> Observable<Option<PermissionsState>> {
    // Option<T> serializes transparently, so subscribers emit the inner state.
    Observable::new(None).emit_to(app, PERMISSIONS_CHANGED_EVENT)
}

/// Read the last-known permissions; `None` when never probed.
pub fn get<R: Runtime>(app: &AppHandle<R>) -> Option<PermissionsState> {
    app.state::<Observable<Option<PermissionsState>>>()
        .read_sync()
        .clone()
}

/// The newest helper row stored so far, and how new it is.
///
/// The helper row has several writers: the convergence loop, the explicit
/// Enable, Retry and Disable actions, and every full [`refresh`]. Each row
/// comes from one reconciliation pass, and passes run one at a time, so
/// "newest" has a definite meaning: the pass that finished last
/// (`reconcile::take_pass_order`). The writers do not reach this cell in that
/// order, though. A refresh probes five other permissions after its helper
/// observation, and a loop pass can be preempted between finishing and
/// publishing. So every write carries its pass's order, and a row is stored
/// only when it is newer than the one recorded here.
///
/// The record is kept even while nothing has been probed and the cell has no
/// rows, so the refresh that fills the cell cannot put an older observation
/// over what was published first.
///
/// Written and read only while the cell's write lock is held, which makes the
/// comparison and the write one step.
struct NewestHelperRow {
    order: u64,
    row: Option<Permission>,
}

static NEWEST_HELPER_ROW: Mutex<NewestHelperRow> = Mutex::new(NewestHelperRow {
    order: 0,
    row: None,
});

/// Probe all permissions and record the result; the cell write emits
/// `permissions_changed`.
///
/// The helper row is the exception to "record the result": it is stored only
/// if no newer helper row has been stored meanwhile (see [`store_refreshed`]).
pub fn refresh<R: Runtime>(app: &AppHandle<R>) -> PermissionsState {
    let observable = app.state::<Observable<Option<PermissionsState>>>();
    let (fresh, helper_order) = permissions::check_all_permissions(app);
    store_refreshed(&observable, &NEWEST_HELPER_ROW, fresh, helper_order)
}

/// Stores a full probe, keeping a newer helper row if one is already stored.
///
/// `helper_order` is the order of the pass the probe's helper row came from.
/// `None` means the probe has no observation of its own (a `Busy` run, or the
/// permission skip); the stored row, when there is one, is then at least as
/// good as whatever the probe fell back to.
///
/// Without this a refresh that observed Ready, and was then overtaken by a
/// Disable whose loop published Removed and exited, would put the Ready row
/// back with no loop left to correct it.
fn store_refreshed(
    observable: &Observable<Option<PermissionsState>>,
    newest: &Mutex<NewestHelperRow>,
    mut fresh: PermissionsState,
    helper_order: Option<u64>,
) -> PermissionsState {
    let mut cell = observable.write_sync();
    let mut newest = newest.lock().unwrap_or_else(PoisonError::into_inner);
    let slot = fresh
        .permissions
        .iter_mut()
        .find(|permission| permission.id == permissions::HELPER_PERMISSION_ID);
    if let Some(slot) = slot {
        match helper_order {
            Some(order) if order > newest.order => {
                newest.order = order;
                newest.row = Some(slot.clone());
            }
            _ => {
                if let Some(kept) = newest.row.clone().or_else(|| helper_row_of(cell.as_ref())) {
                    *slot = kept;
                    fresh.all_required_granted = all_required_granted(&fresh.permissions);
                }
            }
        }
    }
    *cell = Some(fresh.clone());
    fresh
}

fn helper_row_of(state: Option<&PermissionsState>) -> Option<Permission> {
    state?
        .permissions
        .iter()
        .find(|permission| permission.id == permissions::HELPER_PERMISSION_ID)
        .cloned()
}

fn all_required_granted(permissions: &[Permission]) -> bool {
    permissions
        .iter()
        .all(|permission| !permission.required || permission.status == PermissionStatus::Granted)
}

/// Replace the helper's row in the last-known state and re-emit, unless a row
/// from a later pass is already stored.
///
/// The convergence loop cannot use [`refresh`] to publish: that re-probes every
/// permission, and its helper row runs a *second* reconciliation of its own. So
/// the loop reconciles once, turns that report into a row, and drops it in here.
/// The explicit actions publish the report of their own pass the same way.
///
/// `order` is the pass's place among finished passes; a row without one (a
/// `Busy` answer, which observed nothing) is never stored.
///
/// With nothing probed yet the cell has no rows to replace, and inventing the
/// other five here would be worse than waiting for the panel's own refresh.
/// The row is still recorded as the newest, so the refresh that fills the cell
/// does not overwrite it with an older observation.
pub fn replace_helper_row<R: Runtime>(app: &AppHandle<R>, row: Permission, order: Option<u64>) {
    // A build with the permission skip on reports every row Granted, and the
    // onboarding gate depends on that fiction. A real helper row dropped in here
    // would flip `all_required_granted` back to false and close the gate the
    // flag exists to open.
    if permissions::skip_enabled() {
        return;
    }
    let observable = app.state::<Observable<Option<PermissionsState>>>();
    store_helper_row(&observable, &NEWEST_HELPER_ROW, row, order);
}

fn store_helper_row(
    observable: &Observable<Option<PermissionsState>>,
    newest: &Mutex<NewestHelperRow>,
    row: Permission,
    order: Option<u64>,
) {
    debug_assert_eq!(row.id, permissions::HELPER_PERMISSION_ID);
    let Some(order) = order else { return };
    // `update_if_changed` holds the cell's write lock for the closure and
    // notifies subscribers only if the state changed, so a row refused here
    // (or recorded while the cell is still empty) emits nothing.
    observable.update_if_changed(|cell| {
        {
            let mut newest = newest.lock().unwrap_or_else(PoisonError::into_inner);
            if order <= newest.order {
                return;
            }
            newest.order = order;
            newest.row = Some(row.clone());
        }
        let Some(state) = cell.as_mut() else { return };
        let Some(slot) = state.permissions.iter_mut().find(|p| p.id == row.id) else {
            return;
        };
        *slot = row;
        state.all_required_granted = all_required_granted(&state.permissions);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: &str, status: PermissionStatus, required: bool) -> Permission {
        Permission {
            id: id.to_string(),
            name: id.to_string(),
            description: String::new(),
            required,
            can_request_programmatically: true,
            status,
            instructions: None,
            helper_phase: None,
        }
    }

    fn helper(status: PermissionStatus, detail: &str) -> Permission {
        Permission {
            instructions: Some(detail.to_string()),
            ..row(permissions::HELPER_PERMISSION_ID, status, true)
        }
    }

    fn probe(helper_row: Permission) -> PermissionsState {
        let permissions = vec![
            row("full-disk", PermissionStatus::Granted, true),
            helper_row,
        ];
        PermissionsState {
            all_required_granted: all_required_granted(&permissions),
            permissions,
            checked_at: None,
        }
    }

    fn newest() -> Mutex<NewestHelperRow> {
        Mutex::new(NewestHelperRow {
            order: 0,
            row: None,
        })
    }

    fn stored_helper(observable: &Observable<Option<PermissionsState>>) -> Permission {
        helper_row_of(observable.read_sync().as_ref()).expect("a helper row is stored")
    }

    #[test]
    fn a_refresh_overtaken_by_a_disable_keeps_the_removed_row() {
        // The reviewers' interleaving: a refresh observes Ready (pass 1) and
        // pauses on its other probes; a Disable runs (pass 2), its row is
        // published and its loop exits; the refresh then stores. The stored
        // row must stay Removed, because no loop is left to correct a Ready
        // row put back over it.
        let observable = Observable::new(Some(probe(helper(PermissionStatus::Granted, "ready"))));
        let newest = newest();
        let stale = probe(helper(PermissionStatus::Granted, "ready"));

        store_helper_row(
            &observable,
            &newest,
            helper(PermissionStatus::Pending, "removed"),
            Some(2),
        );

        let stored = store_refreshed(&observable, &newest, stale, Some(1));
        let helper_row = stored_helper(&observable);
        assert_eq!(helper_row.status, PermissionStatus::Pending);
        assert_eq!(helper_row.instructions.as_deref(), Some("removed"));
        assert!(!stored.all_required_granted);
        assert!(
            !observable
                .read_sync()
                .as_ref()
                .expect("stored")
                .all_required_granted
        );
    }

    #[test]
    fn a_background_report_that_finished_before_an_action_cannot_replace_its_row() {
        // The same-generation interleaving: a loop pass fails a removal
        // (pass 4), a Retry then succeeds (pass 5) and publishes Disabled, and
        // only then does the loop get to publish. Whichever order the two
        // publications arrive in, the Retry's row stays.
        for loop_publishes_first in [true, false] {
            let observable =
                Observable::new(Some(probe(helper(PermissionStatus::Granted, "ready"))));
            let newest = newest();
            let from_loop = (helper(PermissionStatus::Pending, "removal failed"), Some(4));
            let from_retry = (helper(PermissionStatus::Pending, "removed"), Some(5));
            let (first, second) = if loop_publishes_first {
                (from_loop, from_retry)
            } else {
                (from_retry, from_loop)
            };
            store_helper_row(&observable, &newest, first.0, first.1);
            store_helper_row(&observable, &newest, second.0, second.1);
            assert_eq!(
                stored_helper(&observable).instructions.as_deref(),
                Some("removed"),
                "loop_publishes_first={loop_publishes_first}"
            );
        }
    }

    #[test]
    fn a_busy_refresh_keeps_the_row_published_while_it_probed() {
        // A Busy observation has no order of its own: it falls back to a row
        // read before the probe. If the loop published in between, that
        // fallback is the older one.
        let observable = Observable::new(Some(probe(helper(PermissionStatus::Pending, "old"))));
        let newest = newest();
        let fallback = probe(helper(PermissionStatus::Pending, "old"));

        store_helper_row(
            &observable,
            &newest,
            helper(PermissionStatus::Granted, "ready"),
            Some(1),
        );

        let stored = store_refreshed(&observable, &newest, fallback, None);
        assert_eq!(stored_helper(&observable).status, PermissionStatus::Granted);
        assert!(stored.all_required_granted);
    }

    #[test]
    fn a_refresh_that_observed_last_stores_what_it_probed() {
        let observable = Observable::new(Some(probe(helper(PermissionStatus::Pending, "old"))));
        let newest = newest();
        store_helper_row(
            &observable,
            &newest,
            helper(PermissionStatus::Pending, "older publication"),
            Some(3),
        );
        let fresh = probe(helper(PermissionStatus::Granted, "ready"));

        let stored = store_refreshed(&observable, &newest, fresh, Some(4));
        assert_eq!(stored_helper(&observable).status, PermissionStatus::Granted);
        assert!(stored.all_required_granted);

        // And it now counts as the newest: the older loop report cannot
        // replace it afterwards.
        store_helper_row(
            &observable,
            &newest,
            helper(PermissionStatus::Pending, "late and older"),
            Some(3),
        );
        assert_eq!(stored_helper(&observable).status, PermissionStatus::Granted);
    }

    #[test]
    fn a_first_refresh_with_nothing_published_stores_its_own_row() {
        let observable = Observable::new(None);
        let newest = newest();
        store_refreshed(
            &observable,
            &newest,
            probe(helper(PermissionStatus::Pending, "busy fallback")),
            None,
        );
        assert_eq!(
            stored_helper(&observable).instructions.as_deref(),
            Some("busy fallback")
        );
    }

    #[test]
    fn a_row_published_before_the_first_probe_survives_that_probe() {
        // Startup: the loop settles before anything was probed, so the cell
        // has no rows. The first refresh, whose own observation ran earlier,
        // must not store that observation over what the loop published.
        let observable = Observable::new(None);
        let newest = newest();
        let stale = probe(helper(PermissionStatus::Pending, "before the loop"));

        store_helper_row(
            &observable,
            &newest,
            helper(PermissionStatus::Granted, "ready"),
            Some(2),
        );
        assert!(observable.read_sync().is_none(), "nothing to replace yet");

        store_refreshed(&observable, &newest, stale, Some(1));
        assert_eq!(stored_helper(&observable).status, PermissionStatus::Granted);
    }

    #[test]
    fn a_refused_row_notifies_nobody() {
        let notified = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = notified.clone();
        let observable = Observable::new(Some(probe(helper(PermissionStatus::Pending, "old"))))
            .subscribe(move |_| {
                counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            });
        let newest = newest();
        store_helper_row(
            &observable,
            &newest,
            helper(PermissionStatus::Granted, "ready"),
            Some(2),
        );
        assert_eq!(notified.load(std::sync::atomic::Ordering::SeqCst), 1);

        // Older than the stored row, and a row with no order at all.
        store_helper_row(
            &observable,
            &newest,
            helper(PermissionStatus::Pending, "late and older"),
            Some(1),
        );
        store_helper_row(
            &observable,
            &newest,
            helper(PermissionStatus::Pending, "busy"),
            None,
        );
        assert_eq!(notified.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(stored_helper(&observable).status, PermissionStatus::Granted);
    }

    #[test]
    fn a_row_without_an_order_is_never_stored() {
        let observable = Observable::new(Some(probe(helper(PermissionStatus::Pending, "kept"))));
        let newest = newest();
        store_helper_row(
            &observable,
            &newest,
            helper(PermissionStatus::Granted, "busy"),
            None,
        );
        assert_eq!(
            stored_helper(&observable).instructions.as_deref(),
            Some("kept")
        );
    }
}
