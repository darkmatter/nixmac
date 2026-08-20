//! Last-known macOS permissions — an in-memory mirror of probe results.
//!
//! The OS is the source of truth and probing can trigger permission prompts,
//! so the cell is NOT persisted and getters never probe: [`refresh`] is the
//! explicit probe-and-record entry point, `None` means "never probed since
//! startup".

use tauri::{AppHandle, Manager, Runtime};

use crate::observable::Observable;
use crate::shared_types::{Permission, PermissionsState};
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

/// Probe all permissions and record the result; the cell write emits
/// `permissions_changed`.
pub fn refresh<R: Runtime>(app: &AppHandle<R>) -> PermissionsState {
    let state = permissions::check_all_permissions(app);
    let observable = app.state::<Observable<Option<PermissionsState>>>();
    *observable.write_sync() = Some(state.clone());
    state
}

/// Replace one permission's row in the last-known state and re-emit.
///
/// The convergence loop cannot use [`refresh`] to publish: that re-probes every
/// permission, and its helper row runs a *second* reconciliation of its own. So
/// the loop reconciles once, turns that report into a row, and drops it in here.
///
/// Does nothing when nothing has been probed yet — startup reconciles before any
/// full probe has run, and inventing the other five rows here would be worse than
/// waiting for the panel's own refresh.
pub fn replace_row<R: Runtime>(app: &AppHandle<R>, row: Permission) {
    // A build with the permission skip on reports every row Granted, and the
    // onboarding gate depends on that fiction. A real helper row dropped in here
    // would flip `all_required_granted` back to false and close the gate the
    // flag exists to open.
    if permissions::skip_enabled() {
        return;
    }
    let observable = app.state::<Observable<Option<PermissionsState>>>();
    let mut cell = observable.write_sync();
    let Some(state) = cell.as_mut() else { return };
    let Some(slot) = state.permissions.iter_mut().find(|p| p.id == row.id) else {
        return;
    };
    *slot = row;
    state.all_required_granted = state
        .permissions
        .iter()
        .all(|p| !p.required || p.status == crate::shared_types::PermissionStatus::Granted);
}
