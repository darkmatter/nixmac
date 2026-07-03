//! Launchd item scanning and adoption.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::launchd as cmd;
use crate::shared_types::{ConfigEditApplyResult, LaunchdItem};
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct ApplyItemsInput {
    items: Vec<LaunchdItem>,
}

async fn scan_items(ctx: OrpcCtx, _input: ()) -> Result<Vec<LaunchdItem>, ORPCError> {
    cmd::scan_launchd_items(ctx.app)
        .await
        .map_err(|error| internal_err("launchd.scanItems", error))
}

async fn apply_items(
    ctx: OrpcCtx,
    input: ApplyItemsInput,
) -> Result<ConfigEditApplyResult, ORPCError> {
    cmd::apply_launchd_items(ctx.app, input.items)
        .await
        .map_err(|error| internal_err("launchd.applyItems", error))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "scanItems" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<Vec<LaunchdItem>>())
            .handler(scan_items),
        "applyItems" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<ApplyItemsInput>())
            .output(orpc_specta::specta::<ConfigEditApplyResult>())
            .handler(apply_items),
    }
}
