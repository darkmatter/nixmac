//! nixd LSP server lifecycle (start/send/stop).

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::editor as cmd;
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct SendInput {
    message: String,
}

async fn start(ctx: OrpcCtx, _input: ()) -> Result<(), ORPCError> {
    cmd::lsp_start(ctx.app)
        .await
        .map_err(|e| internal_err("lsp.start", e))
}

async fn send(_ctx: OrpcCtx, input: SendInput) -> Result<(), ORPCError> {
    cmd::lsp_send(input.message)
        .await
        .map_err(|e| internal_err("lsp.send", e))
}

async fn stop(_ctx: OrpcCtx, _input: ()) -> Result<(), ORPCError> {
    cmd::lsp_stop()
        .await
        .map_err(|e| internal_err("lsp.stop", e))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "start" => os::<OrpcCtx>()
            .handler(start),
        "send" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<SendInput>())
            .handler(send),
        "stop" => os::<OrpcCtx>()
            .handler(stop),
    }
}
