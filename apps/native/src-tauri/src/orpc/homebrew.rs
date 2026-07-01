//! Homebrew state diff and adoption.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::homebrew as cmd;
use crate::shared_types::{ConfigEditApplyResult, HomebrewState};
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct ApplyDiffInput {
    diff: HomebrewState,
}

async fn get_state_diff(ctx: OrpcCtx, _input: ()) -> Result<HomebrewState, ORPCError> {
    cmd::homebrew_get_state_diff(ctx.app)
        .await
        .map_err(|error| internal_err("homebrew.getStateDiff", error))
}

async fn apply_diff(
    ctx: OrpcCtx,
    input: ApplyDiffInput,
) -> Result<ConfigEditApplyResult, ORPCError> {
    cmd::homebrew_apply_diff(ctx.app, input.diff)
        .await
        .map_err(|error| internal_err("homebrew.applyDiff", error))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "getStateDiff" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<HomebrewState>())
            .handler(get_state_diff),
        "applyDiff" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<ApplyDiffInput>())
            .output(orpc_specta::specta::<ConfigEditApplyResult>())
            .handler(apply_diff),
    }
}
