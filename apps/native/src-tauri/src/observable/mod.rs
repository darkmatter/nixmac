//! Typed state holder that fans out changes to subscribers.
//!
//! `Observable<T>` owns a value and broadcasts every mutation to a list of
//! subscribers. Subscribers are closures and run synchronously from the write
//! guard's `Drop`; they can serialize to disk, emit Tauri events, push audit
//! logs, or do anything else that reacts to "the value changed."
//!
//! Two recurring patterns get convenience builders:
//!
//! - `.emit_to(&app, "some_event")` — Tauri event emission with the current value
//! - `.persist_to(backend)` — JSON-serialize the value and flush through a
//!   [`Persistence`] backend
//!
//! Both are sugar over `.subscribe(move |value| ...)`. Anything more exotic
//! (debouncing, breadcrumbs, custom transports) just calls `subscribe` with
//! its own closure.
//!
//! ```ignore
//! use crate::observable::Observable;
//!
//! let state = Observable::new(MyState::default())
//!     .emit_to(&app, "my_state_changed")
//!     .persist_to(persistence);
//!
//! {
//!     let mut guard = state.write_sync();
//!     guard.count = 7;
//! }
//! // subscribers fire here as the guard drops.
//! ```
//!
//! `Observable<T>` is meant to live in `tauri::State`. Readers get a synchronous
//! `RwLockReadGuard`; writers get an `ObservableWriteGuard` that is the only
//! mutation path — and therefore the only place subscribers are invoked.

pub mod json_io;
pub mod persistence;

pub use persistence::{AppDataJson, ConfiguredRepoScopedJson, Persistence};

use serde::Serialize;
use std::ops::{Deref, DerefMut};
use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};
use tauri::{AppHandle, Emitter, Runtime};

type Subscriber<T> = Arc<dyn Fn(&T) + Send + Sync + 'static>;

/// Typed state owner with a fan-out list of change subscribers.
pub struct Observable<T> {
    inner: RwLock<T>,
    subscribers: Vec<Subscriber<T>>,
}

impl<T: Send + Sync + 'static> Observable<T> {
    /// Construct an observable from an already materialized initial value.
    pub fn new(initial: T) -> Self {
        Self {
            inner: RwLock::new(initial),
            subscribers: Vec::new(),
        }
    }

    /// Register a closure that runs on every write, with the new value.
    ///
    /// Subscribers fire from the write guard's `Drop` in registration order.
    /// They should not panic; errors are the subscriber's responsibility to
    /// log because `Drop` cannot return them.
    pub fn subscribe(mut self, f: impl Fn(&T) + Send + Sync + 'static) -> Self {
        self.subscribers.push(Arc::new(f));
        self
    }

    /// Borrow the current value synchronously.
    pub fn read_sync(&self) -> RwLockReadGuard<'_, T> {
        self.inner.read().expect("observable lock poisoned")
    }

    /// Borrow the current value mutably; subscribers fire when the guard drops.
    pub fn write_sync(&self) -> ObservableWriteGuard<'_, T> {
        ObservableWriteGuard {
            guard: self.inner.write().expect("observable lock poisoned"),
            subscribers: &self.subscribers,
        }
    }
}

impl<T> Observable<T>
where
    T: Clone + PartialEq + Send + Sync + 'static,
{
    /// Mutate the value while holding its write lock, notifying subscribers
    /// only when the closure actually changes it.
    pub fn update_if_changed(&self, update: impl FnOnce(&mut T)) -> bool {
        let mut guard = self.inner.write().expect("observable lock poisoned");
        let previous = guard.clone();
        update(&mut guard);

        if *guard == previous {
            return false;
        }

        for subscriber in &self.subscribers {
            subscriber(&guard);
        }
        true
    }
}

impl<T> Observable<T>
where
    T: Serialize + Send + Sync + 'static,
{
    /// Subscribe Tauri event emission for this observable.
    ///
    /// On every write, emits `event` to the frontend carrying the new value as
    /// its payload. Emission failures are logged.
    pub fn emit_to<R: Runtime>(self, app: &AppHandle<R>, event: &'static str) -> Self {
        let app = app.clone();
        self.subscribe(move |value| {
            if let Err(error) = app.emit(event, value) {
                log::error!("observable: failed to emit {event}: {error:#}");
            }
        })
    }

    /// Subscribe a [`Persistence`] backend to flush the value on every write.
    ///
    /// The value is JSON-serialized and handed to `backend.flush`. Serialize
    /// or flush errors are logged.
    pub fn persist_to(self, backend: Arc<dyn Persistence>) -> Self {
        self.subscribe(move |value| {
            let json = match serde_json::to_value(value) {
                Ok(json) => json,
                Err(error) => {
                    log::error!("observable: failed to serialize for persistence: {error:#}");
                    return;
                }
            };
            if let Err(error) = backend.flush(&json) {
                log::error!("observable: failed to flush persistence: {error:#}");
            }
        })
    }
}

/// Mutable guard returned by [`Observable::write_sync`].
///
/// Deref's to `T` so callers can mutate fields naturally. On drop it invokes
/// every registered subscriber with the final value.
pub struct ObservableWriteGuard<'a, T> {
    guard: RwLockWriteGuard<'a, T>,
    subscribers: &'a [Subscriber<T>],
}

impl<T> Deref for ObservableWriteGuard<'_, T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        &self.guard
    }
}

impl<T> DerefMut for ObservableWriteGuard<'_, T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.guard
    }
}

impl<T> Drop for ObservableWriteGuard<'_, T> {
    fn drop(&mut self) {
        for subscriber in self.subscribers {
            subscriber(&self.guard);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
    struct DemoState {
        count: u32,
        label: String,
    }

    #[test]
    fn write_guard_fires_subscribers_on_drop_with_final_value() {
        let captured: Arc<Mutex<Vec<DemoState>>> = Arc::new(Mutex::new(Vec::new()));
        let captured_for_closure = captured.clone();
        let observable = Observable::new(DemoState::default()).subscribe(move |value| {
            captured_for_closure.lock().unwrap().push(value.clone());
        });

        {
            let mut guard = observable.write_sync();
            guard.count = 2;
            guard.label = "updated".to_string();
        }

        let events = captured.lock().unwrap();
        assert_eq!(
            events.len(),
            1,
            "subscriber fires once per write guard drop"
        );
        assert_eq!(
            events[0],
            DemoState {
                count: 2,
                label: "updated".to_string()
            }
        );
    }

    #[test]
    fn multiple_subscribers_fire_in_registration_order() {
        let log: Arc<Mutex<Vec<&'static str>>> = Arc::new(Mutex::new(Vec::new()));
        let first = log.clone();
        let second = log.clone();
        let observable = Observable::new(0_u32)
            .subscribe(move |_| first.lock().unwrap().push("first"))
            .subscribe(move |_| second.lock().unwrap().push("second"));

        {
            let mut guard = observable.write_sync();
            *guard = 5;
        }

        assert_eq!(*log.lock().unwrap(), vec!["first", "second"]);
    }

    #[test]
    fn observable_with_no_subscribers_acts_as_in_memory_cell() {
        let observable = Observable::new(0_u32);

        {
            let mut guard = observable.write_sync();
            *guard = 42;
        }

        assert_eq!(*observable.read_sync(), 42);
    }

    #[test]
    fn update_if_changed_is_atomic_and_suppresses_noop_notifications() {
        let captured: Arc<Mutex<Vec<DemoState>>> = Arc::new(Mutex::new(Vec::new()));
        let captured_for_closure = captured.clone();
        let observable = Observable::new(DemoState::default()).subscribe(move |value| {
            captured_for_closure.lock().unwrap().push(value.clone());
        });

        assert!(observable.update_if_changed(|state| state.count = 1));
        assert!(!observable.update_if_changed(|state| state.count = 1));

        assert_eq!(captured.lock().unwrap().len(), 1);
        assert_eq!(observable.read_sync().count, 1);
    }

    #[test]
    fn persist_to_routes_serialized_value_through_backend() {
        use super::Persistence;
        use anyhow::Result;
        use serde_json::Value;

        #[derive(Default)]
        struct CapturingBackend {
            captured: Mutex<Option<Value>>,
        }

        impl Persistence for CapturingBackend {
            fn load(&self) -> Result<Option<Value>> {
                Ok(self.captured.lock().unwrap().clone())
            }

            fn flush(&self, value: &Value) -> Result<()> {
                *self.captured.lock().unwrap() = Some(value.clone());
                Ok(())
            }
        }

        let backend = Arc::new(CapturingBackend::default());
        let observable = Observable::new(DemoState::default()).persist_to(backend.clone());

        {
            let mut guard = observable.write_sync();
            guard.count = 7;
            guard.label = "persisted".into();
        }

        let stored = backend.captured.lock().unwrap().clone().unwrap();
        assert_eq!(stored["count"], 7);
        assert_eq!(stored["label"], "persisted");
    }
}
