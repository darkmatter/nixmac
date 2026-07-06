//! Onboarding lifecycle procedures.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::onboarding;
use crate::shared_types::OkResult;
use orpc::*;

async fn reset(ctx: OrpcCtx, _input: ()) -> Result<OkResult, ORPCError> {
    onboarding::onboarding_reset(ctx.app)
        .await
        .map_err(|error| internal_err("onboarding.reset", error))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "reset" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<OkResult>())
            .handler(reset),
    }
}
