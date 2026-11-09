//! Derived secrets-vault state owned by Rust.
//!
//! A refresh evaluates Nix on a background thread. The generation counter and
//! source re-check prevent an older evaluation from publishing after the
//! config directory or host has changed.

use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, Manager, Runtime};

use crate::observable::Observable;
use crate::shared_types::SecretsVaultState;
use crate::{secrets, storage::store, system::nix};

pub const SECRETS_VAULT_STATE_CHANGED_EVENT: &str = "secrets_vault_state_changed";

static REFRESH_GENERATION: AtomicU64 = AtomicU64::new(0);

pub fn load_observable<R: Runtime>(app: &AppHandle<R>) -> Observable<SecretsVaultState> {
    Observable::new(SecretsVaultState::default()).emit_to(app, SECRETS_VAULT_STATE_CHANGED_EVENT)
}

pub fn get<R: Runtime>(app: &AppHandle<R>) -> SecretsVaultState {
    app.state::<Observable<SecretsVaultState>>()
        .read_sync()
        .clone()
}

fn current_source<R: Runtime>(app: &AppHandle<R>) -> Result<(String, String), String> {
    let host = nix::determine_host_attr(app)
        .filter(|host| !host.is_empty())
        .ok_or_else(|| "No hostname configured".to_string())?;
    let config_dir = store::get_config_dir(app)
        .map_err(|error| format!("No configuration directory configured: {error}"))?;
    Ok((host, config_dir))
}

/// Recompute the vault in the background and publish only if it still belongs
/// to the current config directory and host.
///
/// This is deliberately a no-op when the observable is not managed, which
/// keeps lower-level config helpers usable in isolated tests and early startup.
pub fn refresh<R: Runtime + 'static>(app: &AppHandle<R>) {
    let Some(observable) = app.try_state::<Observable<SecretsVaultState>>() else {
        return;
    };

    let generation = REFRESH_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let source = current_source(app);
    *observable.write_sync() = SecretsVaultState {
        activated: true,
        loading: source.is_ok(),
        error: source.as_ref().err().cloned(),
        vault: None,
    };

    let Ok((host, config_dir)) = source else {
        return;
    };

    let refresh_app = app.clone();
    std::thread::spawn(move || {
        let result = secrets::secrets_management::load_secrets_vault(&host, &config_dir)
            .map_err(|error| format!("Failed to load secrets state: {error}"));

        if REFRESH_GENERATION.load(Ordering::SeqCst) != generation
            || current_source(&refresh_app).ok().as_ref() != Some(&(host, config_dir))
        {
            log::debug!("Discarding stale secrets vault refresh");
            return;
        }

        let Some(observable) = refresh_app.try_state::<Observable<SecretsVaultState>>() else {
            return;
        };
        *observable.write_sync() = match result {
            Ok(vault) => SecretsVaultState {
                vault: Some(vault),
                activated: true,
                loading: false,
                error: None,
            },
            Err(error) => SecretsVaultState {
                vault: None,
                activated: true,
                loading: false,
                error: Some(error),
            },
        };
    });
}

/// Start deriving the vault on its first read. Later reads return the current
/// snapshot without re-running Nix.
pub fn activate<R: Runtime + 'static>(app: &AppHandle<R>) {
    let active = app
        .try_state::<Observable<SecretsVaultState>>()
        .is_some_and(|observable| observable.read_sync().activated);
    if !active {
        refresh(app);
    }
}

/// Refresh a previously activated vault after one of its backend inputs
/// changes. Before first activation this intentionally does nothing.
pub fn refresh_if_active<R: Runtime + 'static>(app: &AppHandle<R>) {
    let active = app
        .try_state::<Observable<SecretsVaultState>>()
        .is_some_and(|observable| observable.read_sync().activated);
    if active {
        refresh(app);
    }
}
