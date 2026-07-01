//! Settings export/import (typed settings slices backup/restore).

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::settings_io as cmd;
use crate::shared_types::{ExportResult, ImportResult};
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct ExportInput {
    include_secrets: bool,
}

async fn export(ctx: OrpcCtx, input: ExportInput) -> Result<Option<ExportResult>, ORPCError> {
    cmd::settings_export(ctx.app, input.include_secrets)
        .await
        .map_err(|e| internal_err("settings.export", e))
}

async fn import(ctx: OrpcCtx, _input: ()) -> Result<Option<ImportResult>, ORPCError> {
    cmd::settings_import(ctx.app)
        .await
        .map_err(|e| internal_err("settings.import", e))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "export" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<ExportInput>())
            .output(orpc_specta::specta::<Option<ExportResult>>())
            .handler(export),
        "import" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<Option<ImportResult>>())
            .handler(import),
    }
}
