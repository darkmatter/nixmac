//! Flake presence checks and default bootstrap.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::config;
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct FlakeExistsAtInput {
    dir: String,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct BootstrapDefaultConfigInput {
    hostname: String,
    template_id: Option<String>,
}

async fn exists(ctx: OrpcCtx, _input: ()) -> Result<bool, ORPCError> {
    config::flake_exists(ctx.app)
        .await
        .map_err(|error| internal_err("flake.exists", error))
}

async fn exists_at(ctx: OrpcCtx, input: FlakeExistsAtInput) -> Result<bool, ORPCError> {
    config::flake_exists_at(ctx.app, input.dir)
        .await
        .map_err(|error| internal_err("flake.existsAt", error))
}

async fn bootstrap_default(
    ctx: OrpcCtx,
    input: BootstrapDefaultConfigInput,
) -> Result<(), ORPCError> {
    config::bootstrap_default_config(ctx.app, input.hostname, input.template_id)
        .await
        .map_err(|error| internal_err("flake.bootstrapDefault", error))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "exists" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<bool>())
            .handler(exists),
        "existsAt" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<FlakeExistsAtInput>())
            .output(orpc_specta::specta::<bool>())
            .handler(exists_at),
        "bootstrapDefault" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<BootstrapDefaultConfigInput>())
            .handler(bootstrap_default),
    }
}
