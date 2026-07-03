//! Config-directory file editor used by the manual-edit diff view.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::editor as cmd;
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct ReadFileInput {
    rel_path: String,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct WriteFileInput {
    rel_path: String,
    content: String,
}

async fn read_file(ctx: OrpcCtx, input: ReadFileInput) -> Result<String, ORPCError> {
    cmd::editor_read_file(ctx.app, input.rel_path)
        .await
        .map_err(|e| internal_err("editor.readFile", e))
}

async fn write_file(ctx: OrpcCtx, input: WriteFileInput) -> Result<(), ORPCError> {
    cmd::editor_write_file(ctx.app, input.rel_path, input.content)
        .await
        .map_err(|e| internal_err("editor.writeFile", e))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "readFile" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<ReadFileInput>())
            .output(orpc_specta::specta::<String>())
            .handler(read_file),
        "writeFile" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<WriteFileInput>())
            .handler(write_file),
    }
}
