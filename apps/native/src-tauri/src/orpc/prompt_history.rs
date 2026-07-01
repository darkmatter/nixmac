//! Prompt history storage.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::ui_prefs as cmd;
use crate::shared_types::OkResult;
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct AddInput {
    prompt: String,
}

async fn get(ctx: OrpcCtx, _input: ()) -> Result<Vec<String>, ORPCError> {
    cmd::get_prompt_history(ctx.app)
        .await
        .map_err(|e| internal_err("promptHistory.get", e))
}

async fn add(ctx: OrpcCtx, input: AddInput) -> Result<OkResult, ORPCError> {
    cmd::add_to_prompt_history(ctx.app, input.prompt)
        .await
        .map_err(|e| internal_err("promptHistory.add", e))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "get" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<Vec<String>>())
            .handler(get),
        "add" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<AddInput>())
            .output(orpc_specta::specta::<OkResult>())
            .handler(add),
    }
}
