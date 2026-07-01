//! History list and backfill procedures — parallel to `commands::summarize`.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::summarize;
use crate::shared_types::HistoryItem;
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct GenerateHistoryFromInput {
    commit_hash: String,
    #[specta(type = f64)]
    number: usize,
}

async fn get(ctx: OrpcCtx, _input: ()) -> Result<Vec<HistoryItem>, ORPCError> {
    summarize::fetch_history(ctx.app)
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
            .output(orpc_specta::specta::<Vec<HistoryItem>>())
            .handler(get),
        "generateFrom" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<GenerateHistoryFromInput>())
            .handler(generate_from),
    }
}
