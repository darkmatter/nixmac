use anyhow::{Context, Result};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use std::{
    fs,
    marker::PhantomData,
    ops::{Deref, DerefMut},
    path::{Path, PathBuf},
    sync::{Arc, RwLock as StdRwLock},
};
use tauri::{Emitter, Manager, Runtime};
use tokio::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

pub trait Persistence: Send + Sync {
    fn load(&self) -> Result<Option<Value>>;
    fn flush(&self, value: &Value) -> Result<()>;
}

#[derive(Debug, Clone)]
pub struct AppDataJson {
    path: PathBuf,
}

impl AppDataJson {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    #[allow(dead_code)]
    pub fn for_app<R: Runtime>(
        app: &tauri::AppHandle<R>,
        file_name: impl AsRef<Path>,
    ) -> Result<Self> {
        let app_data = app
            .path()
            .app_data_dir()
            .context("failed to resolve app data directory")?;
        Ok(Self::new(app_data.join(file_name)))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Persistence for AppDataJson {
    fn load(&self) -> Result<Option<Value>> {
        read_json_file(&self.path)
    }

    fn flush(&self, value: &Value) -> Result<()> {
        write_json_file(&self.path, value)
    }
}

#[derive(Debug, Clone)]
pub struct RepoScopedJson {
    path: PathBuf,
}

impl RepoScopedJson {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    #[allow(dead_code)]
    pub fn for_app<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<Self> {
        Ok(Self::new(
            crate::storage::configurable_scope::repo_store_path(app)?,
        ))
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Persistence for RepoScopedJson {
    fn load(&self) -> Result<Option<Value>> {
        read_json_file(&self.path)
    }

    fn flush(&self, value: &Value) -> Result<()> {
        write_json_file(&self.path, value)
    }
}

pub trait SliceEventEmitter: Clone + Send + Sync + 'static {
    fn emit_slice<T: Serialize + ?Sized>(&self, event: &str, payload: &T) -> Result<()>;
}

impl<R: Runtime> SliceEventEmitter for tauri::AppHandle<R> {
    fn emit_slice<T: Serialize + ?Sized>(&self, event: &str, payload: &T) -> Result<()> {
        self.emit(event, payload)
            .with_context(|| format!("failed to emit slice event {event}"))
    }
}

#[derive(Clone, Copy)]
pub struct RegisteredSliceConfig {
    pub name: &'static str,
    pub event: &'static str,
    pub schema_fn: fn(&tauri::AppHandle<tauri::Wry>) -> Result<configurable::ConfigurableSchema>,
    pub set_field_fn: fn(&tauri::AppHandle<tauri::Wry>, &str, Value) -> Result<()>,
}

#[derive(Default)]
pub struct SliceRegistry {
    entries: StdRwLock<Vec<RegisteredSliceConfig>>,
}

impl SliceRegistry {
    pub fn register(&self, entry: RegisteredSliceConfig) -> Result<()> {
        self.entries
            .write()
            .map_err(|_| anyhow::anyhow!("slice registry lock poisoned"))?
            .push(entry);
        Ok(())
    }

    pub fn entries(&self) -> Result<Vec<RegisteredSliceConfig>> {
        Ok(self
            .entries
            .read()
            .map_err(|_| anyhow::anyhow!("slice registry lock poisoned"))?
            .clone())
    }

    pub fn get(&self, name: &str) -> Result<Option<RegisteredSliceConfig>> {
        Ok(self
            .entries
            .read()
            .map_err(|_| anyhow::anyhow!("slice registry lock poisoned"))?
            .iter()
            .copied()
            .find(|entry| entry.name == name))
    }

    #[allow(dead_code)]
    pub fn schemas(
        &self,
        app: &tauri::AppHandle<tauri::Wry>,
    ) -> Result<Vec<configurable::ConfigurableSchema>> {
        self.entries()?
            .into_iter()
            .map(|entry| (entry.schema_fn)(app))
            .collect()
    }

    #[allow(dead_code)]
    pub fn set_field_by_name(
        &self,
        app: &tauri::AppHandle<tauri::Wry>,
        slice_name: &str,
        field_key: &str,
        value: Value,
    ) -> Result<()> {
        let entry = self
            .get(slice_name)?
            .ok_or_else(|| anyhow::anyhow!("unknown slice config: {slice_name}"))?;
        (entry.set_field_fn)(app, field_key, value)
    }
}

pub struct Slice<T> {
    inner: RwLock<T>,
    event: &'static str,
    persistence: Arc<dyn Persistence>,
}

impl<T> Slice<T>
where
    T: Serialize + DeserializeOwned + Send + Sync + 'static,
{
    pub fn new(event: &'static str, initial: T, persistence: Arc<dyn Persistence>) -> Self {
        Self {
            inner: RwLock::new(initial),
            event,
            persistence,
        }
    }

    pub fn load(
        event: &'static str,
        default: T,
        persistence: Arc<dyn Persistence>,
    ) -> Result<Self> {
        let initial = persistence
            .load()?
            .map(serde_json::from_value)
            .transpose()
            .with_context(|| format!("failed to deserialize slice state for {event}"))?
            .unwrap_or(default);
        Ok(Self::new(event, initial, persistence))
    }

    pub async fn read(&self) -> RwLockReadGuard<'_, T> {
        self.inner.read().await
    }

    pub async fn write<E>(&self, emitter: &E) -> SliceWriteGuard<'_, T, E>
    where
        E: SliceEventEmitter,
    {
        SliceWriteGuard {
            guard: self.inner.write().await,
            event: self.event,
            persistence: self.persistence.clone(),
            emitter: emitter.clone(),
            _state: PhantomData,
        }
    }
}

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

fn read_json_file(path: &Path) -> Result<Option<Value>> {
    match fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map(Some)
            .with_context(|| format!("failed to parse JSON at {}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => {
            Err(error).with_context(|| format!("failed to read JSON at {}", path.display()))
        }
    }
}

fn write_json_file(path: &Path, value: &Value) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory {}", parent.display()))?;
    }
    let json = serde_json::to_vec_pretty(value)
        .with_context(|| format!("failed to serialize JSON for {}", path.display()))?;
    fs::write(path, json).with_context(|| format!("failed to write JSON at {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::{
        AppDataJson, Persistence, RegisteredSliceConfig, RepoScopedJson, Slice, SliceEventEmitter,
        SliceRegistry,
    };
    use anyhow::Result;
    use serde::{Deserialize, Serialize};
    use serde_json::{json, Value};
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
        fn set(&self, value: Value) {
            *self.value.lock().unwrap() = Some(value);
        }

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

    #[tokio::test]
    async fn load_uses_persisted_value_when_available() {
        let persistence = Arc::new(MemoryPersistence::default());
        persistence.set(json!({ "count": 7, "label": "persisted" }));

        let slice = Slice::<DemoState>::load("demo_changed", DemoState::default(), persistence)
            .expect("slice loads");

        assert_eq!(
            *slice.read().await,
            DemoState {
                count: 7,
                label: "persisted".to_string(),
            }
        );
    }

    #[tokio::test]
    async fn write_guard_emits_and_flushes_on_drop() {
        let persistence = Arc::new(MemoryPersistence::default());
        let emitter = RecordingEmitter::default();
        let slice = Slice::new("demo_changed", DemoState::default(), persistence.clone());

        {
            let mut state = slice.write(&emitter).await;
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
                event: "demo_changed",
                schema_fn: schema_stub,
                set_field_fn: set_stub,
            })
            .expect("slice config registers");

        let entries = registry.entries().expect("registry entries load");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "DemoState");
        assert_eq!(entries[0].event, "demo_changed");
        let _schema_fn = entries[0].schema_fn;
        let _set_field_fn = entries[0].set_field_fn;
        assert!(registry
            .get("DemoState")
            .expect("registry lookup")
            .is_some());
    }
}
