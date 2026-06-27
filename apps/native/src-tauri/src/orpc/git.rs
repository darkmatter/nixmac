//! Git commit and diff helpers used during the evolve commit step.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::git;
use crate::shared_types::{CommitResult, FileDiffContents};
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct GitCommitInput {
    message: String,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct GitFileDiffContentsInput {
    filenames: Vec<String>,
}

async fn commit(ctx: OrpcCtx, input: GitCommitInput) -> Result<CommitResult, ORPCError> {
    git::create_commit(ctx.app, input.message)
        .await
        .map_err(|error| internal_err("git.commit", error))
}

async fn file_diff_contents(
    ctx: OrpcCtx,
    input: GitFileDiffContentsInput,
) -> Result<HashMap<String, FileDiffContents>, ORPCError> {
    git::fetch_file_diff_contents(ctx.app, input.filenames)
        .await
        .map_err(|error| internal_err("git.fileDiffContents", error))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "commit" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<GitCommitInput>())
            .output(orpc_specta::specta::<CommitResult>())
            .handler(commit),
        "fileDiffContents" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<GitFileDiffContentsInput>())
            .output(orpc_specta::specta::<HashMap<String, FileDiffContents>>())
            .handler(file_diff_contents),
    }
}
