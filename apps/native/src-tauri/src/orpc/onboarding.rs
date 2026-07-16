//! Onboarding lifecycle procedures.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::onboarding;
use crate::shared_types::{OkResult, OnboardingState};
use crate::state::onboarding as onboarding_state;
use orpc::*;

async fn reset(ctx: OrpcCtx, _input: ()) -> Result<OkResult, ORPCError> {
    onboarding::onboarding_reset(ctx.app)
        .await
        .map_err(|error| internal_err("onboarding.reset", error))
}

async fn get_state(ctx: OrpcCtx, _input: ()) -> Result<OnboardingState, ORPCError> {
    onboarding_state::try_read(&ctx.app)
        .ok_or_else(|| internal_err("onboarding.getState", "Onboarding state not loaded"))
}

async fn complete(ctx: OrpcCtx, _input: ()) -> Result<OkResult, ORPCError> {
    onboarding::onboarding_complete(ctx.app)
        .await
        .map_err(|error| internal_err("onboarding.complete", error))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "reset" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<OkResult>())
            .handler(reset),
        "getState" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<OnboardingState>())
            .handler(get_state),
        "complete" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<OkResult>())
            .handler(complete),
    }
}
