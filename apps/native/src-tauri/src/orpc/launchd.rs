//! Launchd item scanning.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::launchd as cmd;
use crate::shared_types::LaunchdItem;
use orpc::*;

async fn scan_items(ctx: OrpcCtx, _input: ()) -> Result<Vec<LaunchdItem>, ORPCError> {
    cmd::scan_launchd_items(ctx.app)
        .await
        .map_err(|error| internal_err("launchd.scanItems", error))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "scanItems" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<Vec<LaunchdItem>>())
            .handler(scan_items),
    }
}
