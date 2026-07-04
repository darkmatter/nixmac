//! History list and backfill procedures — parallel to `commands::summarize`.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::summarize;
use crate::shared_types::HistoryPage;
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct GetHistoryInput {
    /// Max items to return (page size). `None` uses the backend default.
    #[specta(type = Option<f64>)]
    limit: Option<usize>,
    /// Number of items to skip from HEAD (newest-first offset). `None` = 0.
    #[specta(type = Option<f64>)]
    offset: Option<usize>,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct GenerateHistoryFromInput {
    commit_hash: String,
    #[specta(type = f64)]
    number: usize,
}

async fn get(ctx: OrpcCtx, input: GetHistoryInput) -> Result<HistoryPage, ORPCError> {
    summarize::fetch_history(ctx.app, input.limit, input.offset)
        .await
        .map_err(|error| internal_err("history.get", error))
}

async fn generate_from(ctx: OrpcCtx, input: GenerateHistoryFromInput) -> Result<(), ORPCError> {
    summarize::run_generate_history_from(ctx.app, input.commit_hash, input.number)
        .await
        .map_err(|error| internal_err("history.generateFrom", error))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "get" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<GetHistoryInput>())
            .output(orpc_specta::specta::<HistoryPage>())
            .handler(get),
        "generateFrom" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<GenerateHistoryFromInput>())
            .handler(generate_from),
    }
}
