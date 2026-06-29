//! Low-level access to the legacy `settings.json` key-value store.

use anyhow::Result;
use serde::{Serialize, de::DeserializeOwned};
use std::sync::Arc;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::{Store, StoreExt};

const STORE_PATH: &str = "settings.json";

pub fn get_store<R: Runtime>(app: &AppHandle<R>) -> Result<Arc<Store<R>>> {
    Ok(app.store(STORE_PATH)?)
}

pub fn get_legacy_string<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<Option<String>> {
    let store = get_store(app)?;
    Ok(store.get(key).and_then(|val| {
        val.as_str()
            .filter(|s| !s.is_empty())
            .map(ToString::to_string)
    }))
}

pub fn set_legacy_string<R: Runtime>(app: &AppHandle<R>, key: &str, value: &str) -> Result<()> {
    let store = get_store(app)?;
    store.set(key, serde_json::json!(value));
    store.save()?;
    Ok(())
}

pub fn delete_legacy_key<R: Runtime>(app: &AppHandle<R>, key: &str) -> Result<()> {
    let store = get_store(app)?;
    store.delete(key);
    store.save()?;
    Ok(())
}

pub fn get_json<R, T>(app: &AppHandle<R>, key: &str) -> Result<Option<T>>
where
    R: Runtime,
    T: DeserializeOwned,
{
    let store = get_store(app)?;
    Ok(store
        .get(key)
        .and_then(|value| serde_json::from_value(value.clone()).ok()))
}

pub fn set_json<R, T>(app: &AppHandle<R>, key: &str, value: &T) -> Result<()>
where
    R: Runtime,
    T: Serialize + ?Sized,
{
    let store = get_store(app)?;
    store.set(key, serde_json::to_value(value)?);
    store.save()?;
    Ok(())
}
