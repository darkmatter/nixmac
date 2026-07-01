//! AI CLI tool detection (claude/codex/opencode).

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::cli_tool as cmd;
use crate::shared_types::CliToolsState;
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct ListModelsInput {
    tool: String,
}

async fn check_tools(_ctx: OrpcCtx, _input: ()) -> Result<CliToolsState, ORPCError> {
    cmd::check_cli_tools()
        .await
        .map_err(|e| internal_err("cli.checkTools", e))
}

async fn list_models(_ctx: OrpcCtx, input: ListModelsInput) -> Result<Vec<String>, ORPCError> {
    cmd::list_cli_models(input.tool)
        .await
        .map_err(|e| internal_err("cli.listModels", e))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "checkTools" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<CliToolsState>())
            .handler(check_tools),
        "listModels" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<ListModelsInput>())
            .output(orpc_specta::specta::<Vec<String>>())
            .handler(list_models),
    }
}
