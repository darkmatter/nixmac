//! Secrets management procedures.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::secrets_management as cmd;
use crate::shared_types::SecretsVault;
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct DecryptSecretInput {
    secret_id: String,
}

async fn get_vault(ctx: OrpcCtx, _input: ()) -> Result<SecretsVault, ORPCError> {
    cmd::load_secrets_vault(ctx.app)
        .await
        .map_err(|error| internal_err("secrets.getVault", error))
}

async fn decrypt_secret(ctx: OrpcCtx, input: DecryptSecretInput) -> Result<String, ORPCError> {
    cmd::decrypt_secret(ctx.app, input.secret_id)
        .await
        .map_err(|error| internal_err("secrets.decryptSecret", error))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "getVault" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<SecretsVault>())
            .handler(get_vault),
        "decryptSecret" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<DecryptSecretInput>())
            .output(orpc_specta::specta::<String>())
            .handler(decrypt_secret),
    }
}
