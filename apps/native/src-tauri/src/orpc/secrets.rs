//! Secrets management procedures.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::helpers::get_hostname_and_config_dir;
use crate::shared_types::SecretsVaultState;
use crate::state::secrets_vault;
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct DecryptSecretInput {
    secret_id: String,
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

    crate::secrets::secrets_management::decrypt_secret(&host_attr, &config_dir, &input.secret_id)
        .map_err(|error| {
            internal_err(
                "secrets.decryptSecret",
                format!("Failed to decrypt secret: {error}"),
            )
        })
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
    }
}
