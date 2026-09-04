//! Secrets management procedures.

use super::{OrpcCtx, helpers::internal_err};
use crate::shared_types::{
    AddSecretResult, DeleteSecretResult, EditSecretResult, SecretsVaultState,
};
use crate::state::secrets_vault;
use crate::{commands::helpers::get_hostname_and_config_dir, shared_types::SecretBackend};
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct DecryptSecretInput {
    secret_id: String,
    backend: SecretBackend,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct AddSecretInput {
    secret_id: String,
    value: String,
    backend: SecretBackend,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct EditSecretInput {
    secret_id: String,
    value: String,
    backend: SecretBackend,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct DeleteSecretInput {
    secret_id: String,
    backend: SecretBackend,
}

/// Returns the backend-owned secrets vault snapshot.
async fn get_state(ctx: OrpcCtx, _input: ()) -> Result<SecretsVaultState, ORPCError> {
    secrets_vault::activate(&ctx.app);
    Ok(secrets_vault::get(&ctx.app))
}

/// Requests a backend refresh. Completion is published through the observable.
async fn refresh(ctx: OrpcCtx, _input: ()) -> Result<(), ORPCError> {
    secrets_vault::refresh(&ctx.app);
    Ok(())
}

/// Decrypts a single secret from the configured repo, returning its plaintext value.
/// Use caution.
async fn decrypt_secret(ctx: OrpcCtx, input: DecryptSecretInput) -> Result<String, ORPCError> {
    let (host_attr, config_dir) = get_hostname_and_config_dir(&ctx.app, "secrets.decryptSecret")
        .map_err(|error| internal_err("secrets.decryptSecret", error))?;

    crate::secrets::secrets_management::decrypt_secret(
        &host_attr,
        &config_dir,
        &input.secret_id,
        input.backend,
    )
    .map_err(|error| {
        internal_err(
            "secrets.decryptSecret",
            format!("Failed to decrypt secret: {error}"),
        )
    })
}

async fn add_secret(ctx: OrpcCtx, input: AddSecretInput) -> Result<AddSecretResult, ORPCError> {
    let (host_attr, config_dir) = get_hostname_and_config_dir(&ctx.app, "secrets.addSecret")
        .map_err(|error| internal_err("secrets.addSecret", error))?;
    let _refresh_guard = secrets_vault::begin_mutation(&ctx.app);
    let result = crate::secrets::secrets_management::add_secret(
        &host_attr,
        &config_dir,
        &input.secret_id,
        &input.value,
        input.backend,
    )
    .map_err(|error| internal_err("secrets.addSecret", error))?;
    refresh_state_after_mutation(&ctx, &config_dir, "secrets.addSecret");
    Ok(result)
}

async fn edit_secret(ctx: OrpcCtx, input: EditSecretInput) -> Result<EditSecretResult, ORPCError> {
    let (host_attr, config_dir) = get_hostname_and_config_dir(&ctx.app, "secrets.editSecret")
        .map_err(|error| internal_err("secrets.editSecret", error))?;
    let result = crate::secrets::secrets_management::edit_secret(
        &host_attr,
        &config_dir,
        &input.secret_id,
        &input.value,
        input.backend,
    )
    .map_err(|error| internal_err("secrets.editSecret", error))?;
    refresh_state_after_mutation(&ctx, &config_dir, "secrets.editSecret");
    Ok(result)
}

async fn delete_secret(
    ctx: OrpcCtx,
    input: DeleteSecretInput,
) -> Result<DeleteSecretResult, ORPCError> {
    let (host_attr, config_dir) = get_hostname_and_config_dir(&ctx.app, "secrets.deleteSecret")
        .map_err(|error| internal_err("secrets.deleteSecret", error))?;
    let _refresh_guard = secrets_vault::begin_mutation(&ctx.app);
    let result = crate::secrets::secrets_management::delete_secret(
        &host_attr,
        &config_dir,
        &input.secret_id,
        input.backend,
    )
    .map_err(|error| internal_err("secrets.deleteSecret", error))?;
    refresh_state_after_mutation(&ctx, &config_dir, "secrets.deleteSecret");
    Ok(result)
}

/// Record the commit in the shared Git snapshot and let that state transition
/// invalidate the derived vault. Without updating Git state here, the explicit
/// vault refresh completes first and the polling watcher notices the same HEAD
/// change a few seconds later, causing a second refresh.
fn refresh_state_after_mutation(ctx: &OrpcCtx, config_dir: &str, operation: &str) {
    if let Err(error) = crate::git::query::status_and_cache(config_dir, &ctx.app) {
        // The mutation and commit already succeeded, so don't report a false
        // operation failure just because the auxiliary Git snapshot failed.
        // Fall back to the direct invalidation used before this state was
        // synchronized here.
        log::warn!("[{operation}] Failed to refresh Git state: {error}");
        secrets_vault::refresh(&ctx.app);
    }
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "getState" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<SecretsVaultState>())
            .handler(get_state),
        "refresh" => os::<OrpcCtx>()
            .handler(refresh),
        "decryptSecret" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<DecryptSecretInput>())
            .output(orpc_specta::specta::<String>())
            .handler(decrypt_secret),
        "addSecret" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<AddSecretInput>())
            .output(orpc_specta::specta::<AddSecretResult>())
            .handler(add_secret),
        "editSecret" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<EditSecretInput>())
            .output(orpc_specta::specta::<EditSecretResult>())
            .handler(edit_secret),
        "deleteSecret" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<DeleteSecretInput>())
            .output(orpc_specta::specta::<DeleteSecretResult>())
            .handler(delete_secret),
    }
}
