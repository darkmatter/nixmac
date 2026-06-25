//! Preview indicator overlay window — parallel to `commands::peek` preview procedures.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::peek;
use crate::shared_types::{OkResult, PreviewIndicatorState};
use orpc::*;

async fn show(ctx: OrpcCtx, _input: ()) -> Result<OkResult, ORPCError> {
    peek::show_preview_indicator(ctx.app)
        .await
        .map_err(|error| internal_err("previewIndicator.show", error))
}

async fn hide(ctx: OrpcCtx, _input: ()) -> Result<OkResult, ORPCError> {
    peek::hide_preview_indicator(ctx.app)
        .await
        .map_err(|error| internal_err("previewIndicator.hide", error))
}

async fn update(ctx: OrpcCtx, input: PreviewIndicatorState) -> Result<OkResult, ORPCError> {
    peek::update_preview_indicator(ctx.app, input)
        .await
        .map_err(|error| internal_err("previewIndicator.update", error))
}

async fn get_state(_ctx: OrpcCtx, _input: ()) -> Result<PreviewIndicatorState, ORPCError> {
    peek::fetch_preview_indicator_state()
        .await
        .map_err(|error| internal_err("previewIndicator.getState", error))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "show" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<OkResult>())
            .handler(show),
        "hide" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<OkResult>())
            .handler(hide),
        "update" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<PreviewIndicatorState>())
            .output(orpc_specta::specta::<OkResult>())
            .handler(update),
        "getState" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<PreviewIndicatorState>())
            .handler(get_state),
    }
}
