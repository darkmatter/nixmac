//! Last-known macOS permissions — an in-memory mirror of probe results.
//!
//! The OS is the source of truth and probing can trigger permission prompts,
//! so the cell is NOT persisted and getters never probe: [`refresh`] is the
//! explicit probe-and-record entry point, `None` means "never probed since
//! startup".

use tauri::{AppHandle, Manager, Runtime};

use crate::observable::Observable;
use crate::shared_types::PermissionsState;
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
    let state = permissions::check_all_permissions();
    let observable = app.state::<Observable<Option<PermissionsState>>>();
    *observable.write_sync() = Some(state.clone());
    state
}
