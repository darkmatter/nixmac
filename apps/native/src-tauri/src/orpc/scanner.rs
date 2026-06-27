//! System defaults scanning.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::system_defaults as cmd;
use crate::shared_types::SystemDefaultsScan;
use orpc::*;

async fn scan_defaults(ctx: OrpcCtx, _input: ()) -> Result<SystemDefaultsScan, ORPCError> {
    cmd::scan_system_defaults(ctx.app)
        .await
        .map_err(|error| internal_err("scanner.scanDefaults", error))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "scanDefaults" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<SystemDefaultsScan>())
            .handler(scan_defaults),
    }
}
