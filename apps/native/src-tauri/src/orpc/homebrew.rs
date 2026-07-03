//! Homebrew state diff and adoption.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::homebrew as cmd;
use crate::shared_types::{ConfigEditApplyResult, HomebrewItem, HomebrewState};
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct ApplyDiffInput {
    diff: HomebrewState,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct AddItemsInput {
    items: Vec<HomebrewItem>,
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

async fn add_items(ctx: OrpcCtx, input: AddItemsInput) -> Result<ConfigEditApplyResult, ORPCError> {
    cmd::homebrew_add_items(ctx.app, input.items)
        .await
        .map_err(|error| internal_err("homebrew.addItems", error))
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
        "addItems" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<AddItemsInput>())
            .output(orpc_specta::specta::<ConfigEditApplyResult>())
            .handler(add_items),
    }
}
