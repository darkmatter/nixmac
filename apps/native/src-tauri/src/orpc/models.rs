//! Cached AI model lists per provider.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::ui_prefs as cmd;
use crate::shared_types::OkResult;
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct ProviderInput {
    provider: String,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct SetCachedInput {
    provider: String,
    models: Vec<String>,
}

async fn get_cached(ctx: OrpcCtx, input: ProviderInput) -> Result<Option<Vec<String>>, ORPCError> {
    cmd::get_cached_models(ctx.app, input.provider)
        .await
        .map_err(|e| internal_err("models.getCached", e))
}

async fn set_cached(ctx: OrpcCtx, input: SetCachedInput) -> Result<OkResult, ORPCError> {
    cmd::set_cached_models(ctx.app, input.provider, input.models)
        .await
        .map_err(|e| internal_err("models.setCached", e))
}

async fn clear_cached(ctx: OrpcCtx, input: ProviderInput) -> Result<OkResult, ORPCError> {
    cmd::clear_cached_models(ctx.app, input.provider)
        .await
        .map_err(|e| internal_err("models.clearCached", e))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "getCached" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<ProviderInput>())
            .output(orpc_specta::specta::<Option<Vec<String>>>())
            .handler(get_cached),
        "setCached" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<SetCachedInput>())
            .output(orpc_specta::specta::<OkResult>())
            .handler(set_cached),
        "clearCached" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<ProviderInput>())
            .output(orpc_specta::specta::<OkResult>())
            .handler(clear_cached),
    }
}
