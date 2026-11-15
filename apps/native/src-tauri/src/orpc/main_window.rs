//! Main-window mode and popover lifecycle procedures.

use super::{OrpcCtx, helpers::internal_err};
use crate::main_window;
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct CloseRequestInput {
    token: u32,
}

async fn is_popover(ctx: OrpcCtx, _input: ()) -> Result<bool, ORPCError> {
    Ok(main_window::active(&ctx.app).is_popover())
}

async fn dismiss_popover(ctx: OrpcCtx, _input: ()) -> Result<bool, ORPCError> {
    main_window::dismiss(&ctx.app, main_window::active(&ctx.app))
        .map_err(|error| internal_err("mainWindow.dismissPopover", error))
}

async fn dismiss_close(ctx: OrpcCtx, input: CloseRequestInput) -> Result<bool, ORPCError> {
    main_window::dismiss_close(&ctx.app, input.token)
        .map_err(|error| internal_err("mainWindow.dismissClose", error))
}

async fn acknowledge_close(_ctx: OrpcCtx, input: CloseRequestInput) -> Result<bool, ORPCError> {
    Ok(main_window::acknowledge_close(input.token))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "isPopover" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<bool>())
            .handler(is_popover),
        "dismissPopover" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<bool>())
            .handler(dismiss_popover),
        "dismissClose" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<CloseRequestInput>())
            .output(orpc_specta::specta::<bool>())
            .handler(dismiss_close),
        "acknowledgeClose" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<CloseRequestInput>())
            .output(orpc_specta::specta::<bool>())
            .handler(acknowledge_close),
    }
}
