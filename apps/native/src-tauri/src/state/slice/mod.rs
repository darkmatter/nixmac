//! Typed state slices for Rust-owned application state.
//!
//! A `Slice<T>` gives a state owner three things in one place:
//! typed in-memory access, a persistence backend, and automatic UI
//! notification. Callers mutate state through `SliceWriteGuard`; when the
//! guard is dropped it emits the configured change event and then flushes the
//! serialized state through the configured `Persistence` implementation.
//!
//! This module is intentionally generic. Later migrations can put runtime
//! state, global preferences, and repo-scoped preferences on the same primitive
//! without leaking the chosen storage location into command call sites.
//!
//! To use this module:
//!
//! 1. Define a state type that implements the required interfaces:
//!    `serde::Serialize`, `serde::Deserialize`, `Send`, `Sync`, and `'static`.
//! 2. Choose a persistence backend, usually `AppDataJson` for per-device state
//!    or `RepoScopedJson` for config-repo state.
//! 3. Manage the slice in Tauri startup with a stable change-event name.
//! 4. Read through `State<'_, Slice<T>>`.
//! 5. Write through `slice.write_sync(&app)`; dropping the guard emits the
//!    change event and flushes JSON.
//!
//! Important storage contract: the current persistence implementations are
//! whole-file backends. A slice serializes its entire `T` and overwrites the
//! backend path on flush, so two slices must not share the same JSON file unless
//! the persistence layer is changed to be key-aware.
//!
//! ```ignore
//! #[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
//! struct MyState {
//!     enabled: bool,
//! }
//!
//! // Startup:
//! let persistence = std::sync::Arc::new(AppDataJson::for_app(app.handle(), "my-state.json")?);
//! let initial = persistence
//!     .load()?
//!     .map(serde_json::from_value)
//!     .transpose()?
//!     .unwrap_or_default();
//! app.manage(Slice::new(
//!     "my_state_changed",
//!     initial,
//!     persistence,
//! ));
//!
//! // Command:
//! #[tauri::command]
//! async fn set_enabled(
//!     app: tauri::AppHandle,
//!     state: tauri::State<'_, Slice<MyState>>,
//!     enabled: bool,
//! ) {
//!     let mut current = state.write_sync(&app);
//!     current.enabled = enabled;
//! }
//! ```

// Slice<T> itself has no callers after the Observable<T> migration; the next
// commit deletes it. Persistence + registry stay alive for now.
#![allow(dead_code)]

pub mod json_io;
pub mod persistence;
pub mod registry;

pub use persistence::{AppDataJson, ConfiguredRepoScopedJson, Persistence};
pub use registry::{RegisteredSliceConfig, SliceRegistry};

use anyhow::{Context, Result};
use serde::Serialize;
use std::{
    marker::PhantomData,
    ops::{Deref, DerefMut},
    sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard},
};
use tauri::{Emitter, Runtime};

/// Minimal event boundary used by `SliceWriteGuard`.
///
/// The production implementation is `tauri::AppHandle`; tests can provide a
/// recorder without constructing a full Tauri app.
pub trait SliceEventEmitter: Clone + Send + Sync + 'static {
    /// Emit the slice change event with the current state payload.
    fn emit_slice<T: Serialize + ?Sized>(&self, event: &str, payload: &T) -> Result<()>;
}

impl<R: Runtime> SliceEventEmitter for tauri::AppHandle<R> {
    fn emit_slice<T: Serialize + ?Sized>(&self, event: &str, payload: &T) -> Result<()> {
        self.emit(event, payload)
            .with_context(|| format!("failed to emit slice event {event}"))
    }
}

/// Typed state owner with pluggable persistence and a configured change event.
///
/// `Slice<T>` is meant to be stored in `tauri::State`. Readers get an async
/// read guard. Writers get a `SliceWriteGuard`, which is the only mutation path
/// and therefore the single place that emits and persists changes.
pub struct Slice<T> {
    inner: RwLock<T>,
    event: &'static str,
    persistence: Arc<dyn Persistence>,
}

impl<T> Slice<T>
where
    T: Serialize + Send + Sync + 'static,
{
    /// Create a slice from an already materialized initial state.
    pub fn new(event: &'static str, initial: T, persistence: Arc<dyn Persistence>) -> Self {
        Self {
            inner: RwLock::new(initial),
            event,
            persistence,
        }
    }

    /// Synchronously borrow the current in-memory state.
    pub fn read_sync(&self) -> RwLockReadGuard<'_, T> {
        self.inner.read().expect("slice lock poisoned")
    }

    /// Synchronously borrow state and return a guard that emits and flushes on drop.
    pub fn write_sync<E>(&self, emitter: &E) -> SliceWriteGuard<'_, T, E>
    where
        E: SliceEventEmitter,
    {
        SliceWriteGuard {
            guard: self.inner.write().expect("slice lock poisoned"),
            event: self.event,
            persistence: self.persistence.clone(),
            emitter: emitter.clone(),
            _state: PhantomData,
        }
    }
}

/// Mutable slice guard that owns notification and persistence.
///
/// The guard dereferences to `T`, so callers can update fields naturally. On
/// drop it emits the configured event first, then serializes and flushes the
/// final value. Errors are logged because `Drop` cannot return them.
pub struct SliceWriteGuard<'a, T, E>
where
    T: Serialize,
    E: SliceEventEmitter,
{
    guard: RwLockWriteGuard<'a, T>,
    event: &'static str,
    persistence: Arc<dyn Persistence>,
    emitter: E,
    _state: PhantomData<T>,
}

impl<T, E> SliceWriteGuard<'_, T, E>
where
    T: Serialize,
    E: SliceEventEmitter,
{
    /// Flush the current guard value through the configured persistence backend.
    pub fn flush(&self) -> Result<()> {
        let value = serde_json::to_value(&*self.guard)
            .with_context(|| format!("failed to serialize slice state for {}", self.event))?;
        self.persistence.flush(&value)
    }
}

impl<T, E> Deref for SliceWriteGuard<'_, T, E>
where
    T: Serialize,
    E: SliceEventEmitter,
{
    type Target = T;

    fn deref(&self) -> &Self::Target {
        &self.guard
    }
}

impl<T, E> DerefMut for SliceWriteGuard<'_, T, E>
where
    T: Serialize,
    E: SliceEventEmitter,
{
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.guard
    }
}

impl<T, E> Drop for SliceWriteGuard<'_, T, E>
where
    T: Serialize,
    E: SliceEventEmitter,
{
    fn drop(&mut self) {
        if let Err(error) = self.emitter.emit_slice(self.event, &*self.guard) {
            log::error!("failed to emit slice change for {}: {error:#}", self.event);
        }
        if let Err(error) = self.flush() {
            log::error!("failed to flush slice state for {}: {error:#}", self.event);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::persistence::RepoScopedJson;
    use super::{
        AppDataJson, Persistence, RegisteredSliceConfig, Slice, SliceEventEmitter, SliceRegistry,
    };
    use anyhow::Result;
    use serde::{Deserialize, Serialize};
    use serde_json::{Value, json};
    use std::sync::{Arc, Mutex};

    #[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
    struct DemoState {
        count: u32,
        label: String,
    }

    #[derive(Default)]
    struct MemoryPersistence {
        value: Mutex<Option<Value>>,
    }

    impl MemoryPersistence {
        fn value(&self) -> Option<Value> {
            self.value.lock().unwrap().clone()
        }
    }

    impl Persistence for MemoryPersistence {
        fn load(&self) -> Result<Option<Value>> {
            Ok(self.value())
        }

        fn flush(&self, value: &Value) -> Result<()> {
            *self.value.lock().unwrap() = Some(value.clone());
            Ok(())
        }
    }

    #[derive(Clone, Default)]
    struct RecordingEmitter {
        events: Arc<Mutex<Vec<(String, Value)>>>,
    }

    impl RecordingEmitter {
        fn events(&self) -> Vec<(String, Value)> {
            self.events.lock().unwrap().clone()
        }
    }

    impl SliceEventEmitter for RecordingEmitter {
        fn emit_slice<T: Serialize + ?Sized>(&self, event: &str, payload: &T) -> Result<()> {
            self.events
                .lock()
                .unwrap()
                .push((event.to_string(), serde_json::to_value(payload)?));
            Ok(())
        }
    }

    #[test]
    fn write_guard_emits_and_flushes_on_drop() {
        let persistence = Arc::new(MemoryPersistence::default());
        let emitter = RecordingEmitter::default();
        let slice = Slice::new("demo_changed", DemoState::default(), persistence.clone());

        {
            let mut state = slice.write_sync(&emitter);
            state.count = 2;
            state.label = "updated".to_string();
        }

        let expected = json!({ "count": 2, "label": "updated" });
        assert_eq!(
            emitter.events(),
            vec![("demo_changed".to_string(), expected.clone())]
        );
        assert_eq!(persistence.value(), Some(expected));
    }

    #[test]
    fn json_persistence_round_trips_by_scope_path() {
        let temp = tempfile::tempdir().expect("temp dir");
        let app_data = AppDataJson::new(temp.path().join("app-data").join("settings.json"));
        let repo_scoped = RepoScopedJson::new(
            temp.path()
                .join("repo")
                .join(".nixmac")
                .join("settings.json"),
        );

        app_data
            .flush(&json!({ "count": 3, "label": "global" }))
            .expect("app data flushes");
        repo_scoped
            .flush(&json!({ "count": 4, "label": "repo" }))
            .expect("repo scoped flushes");

        assert!(app_data.path().ends_with("app-data/settings.json"));
        assert!(repo_scoped.path().ends_with("repo/.nixmac/settings.json"));
        assert_eq!(
            app_data.load().expect("app data loads"),
            Some(json!({ "count": 3, "label": "global" }))
        );
        assert_eq!(
            repo_scoped.load().expect("repo scoped loads"),
            Some(json!({ "count": 4, "label": "repo" }))
        );
    }

    #[test]
    fn registry_exposes_registered_slice_configs() {
        fn schema_stub(
            _: &tauri::AppHandle<tauri::Wry>,
        ) -> Result<configurable::ConfigurableSchema> {
            unreachable!("schema is not invoked by this registry test")
        }

        fn set_stub(_: &tauri::AppHandle<tauri::Wry>, _: &str, _: serde_json::Value) -> Result<()> {
            unreachable!("set is not invoked by this registry test")
        }

        let registry = SliceRegistry::default();
        registry
            .register(RegisteredSliceConfig {
                name: "DemoState",
                schema_fn: schema_stub,
                set_field_fn: set_stub,
            })
            .expect("slice config registers");

        let entries = registry.entries().expect("registry entries load");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "DemoState");
        let _schema_fn = entries[0].schema_fn;
        let _set_field_fn = entries[0].set_field_fn;
        assert!(
            registry
                .get("DemoState")
                .expect("registry lookup")
                .is_some()
        );
    }
}
