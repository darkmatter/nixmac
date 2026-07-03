//! System defaults scanning and adoption.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::system_defaults as cmd;
use crate::shared_types::{
    ConfigEditApplyResult, RecommendedPrompt, SystemDefault, SystemDefaultsScan,
};
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct ApplyDefaultsInput {
    defaults: Vec<SystemDefault>,
}

async fn get_recommended_prompt(
    _ctx: OrpcCtx,
    _input: (),
) -> Result<Option<RecommendedPrompt>, ORPCError> {
    cmd::get_recommended_prompt()
        .await
        .map_err(|e| internal_err("scanner.getRecommendedPrompt", e))
}

async fn scan_defaults(ctx: OrpcCtx, _input: ()) -> Result<SystemDefaultsScan, ORPCError> {
    cmd::scan_system_defaults(ctx.app)
        .await
        .map_err(|error| internal_err("scanner.scanDefaults", error))
}

async fn apply_defaults(
    ctx: OrpcCtx,
    input: ApplyDefaultsInput,
) -> Result<ConfigEditApplyResult, ORPCError> {
    cmd::apply_system_defaults(ctx.app, input.defaults)
        .await
        .map_err(|e| internal_err("scanner.applyDefaults", e))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "getRecommendedPrompt" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<Option<RecommendedPrompt>>())
            .handler(get_recommended_prompt),
        "scanDefaults" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<SystemDefaultsScan>())
            .handler(scan_defaults),
        "applyDefaults" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<ApplyDefaultsInput>())
            .output(orpc_specta::specta::<ConfigEditApplyResult>())
            .handler(apply_defaults),
    }
}
