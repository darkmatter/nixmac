//! Last-known semantic change map — an in-memory mirror of DB-derived state.
//!
//! The database remains the source of truth, so the cell is NOT persisted:
//! the watcher and the summarize pipelines recompute the value and write it
//! here. `None` means the cell is cold (nothing computed since startup);
//! readers seed it through `get_change_map` rather than treating that as an
//! empty map.

use tauri::{AppHandle, Manager, Runtime};

use crate::observable::Observable;
use crate::shared_types::SemanticChangeMap;

pub const CHANGE_MAP_CHANGED_EVENT: &str = "change_map_changed";

pub fn load_observable<R: Runtime>(app: &AppHandle<R>) -> Observable<Option<SemanticChangeMap>> {
    // Option<T> serializes transparently, so subscribers emit the inner map.
    Observable::new(None).emit_to(app, CHANGE_MAP_CHANGED_EVENT)
}

/// Read the last-known change map; `None` when the cell is cold.
pub fn get<R: Runtime>(app: &AppHandle<R>) -> Option<SemanticChangeMap> {
    app.state::<Observable<Option<SemanticChangeMap>>>()
        .read_sync()
        .clone()
}

/// Write the cell — and notify subscribers — when `next` differs from the
/// current value. Returns whether a write happened.
pub fn update<R: Runtime>(app: &AppHandle<R>, next: SemanticChangeMap) -> bool {
    let observable = app.state::<Observable<Option<SemanticChangeMap>>>();
    if observable.read_sync().as_ref() == Some(&next) {
        return false;
    }
    *observable.write_sync() = Some(next);
    true
}
