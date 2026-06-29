//! Change-map and commit-message procedures — parallel to `commands::summarize`.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::summarize;
use crate::shared_types::SemanticChangeMap;
use orpc::*;

async fn get_change_map(ctx: OrpcCtx, _input: ()) -> Result<SemanticChangeMap, ORPCError> {
    summarize::fetch_change_map(ctx.app)
        .await
        .map_err(|error| internal_err("summarizedChanges.getChangeMap", error))
}

async fn find_change_map(ctx: OrpcCtx, _input: ()) -> Result<SemanticChangeMap, ORPCError> {
    summarize::refresh_change_map(ctx.app)
        .await
        .map_err(|error| internal_err("summarizedChanges.findChangeMap", error))
}

async fn summarize_current(ctx: OrpcCtx, _input: ()) -> Result<SemanticChangeMap, ORPCError> {
    summarize::run_summarize_current(ctx.app)
        .await
        .map_err(|error| internal_err("summarizedChanges.summarizeCurrent", error))
}

async fn generate_commit_message(ctx: OrpcCtx, _input: ()) -> Result<String, ORPCError> {
    summarize::run_generate_commit_message(ctx.app)
        .await
        .map_err(|error| internal_err("summarizedChanges.generateCommitMessage", error))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "getChangeMap" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<SemanticChangeMap>())
            .handler(get_change_map),
        "findChangeMap" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<SemanticChangeMap>())
            .handler(find_change_map),
        "summarizeCurrent" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<SemanticChangeMap>())
            .handler(summarize_current),
        "generateCommitMessage" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<String>())
            .handler(generate_commit_message),
    }
}
