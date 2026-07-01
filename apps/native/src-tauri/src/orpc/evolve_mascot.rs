//! Experimental spinning-mascot indicator window during evolve/build.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::peek as cmd;
use crate::shared_types::OkResult;
use orpc::*;

async fn show(ctx: OrpcCtx, _input: ()) -> Result<OkResult, ORPCError> {
    cmd::evolve_mascot_show(ctx.app)
        .await
        .map_err(|e| internal_err("evolveMascot.show", e))
}

async fn hide(ctx: OrpcCtx, _input: ()) -> Result<OkResult, ORPCError> {
    cmd::evolve_mascot_hide(ctx.app)
        .await
        .map_err(|e| internal_err("evolveMascot.hide", e))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "show" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<OkResult>())
            .handler(show),
        "hide" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<OkResult>())
            .handler(hide),
    }
}
