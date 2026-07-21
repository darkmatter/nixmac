//! Git commit and diff helpers used during the evolve commit step.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::git;
use crate::shared_types::{CommitResult, FileDiffContents, GitState, GitStatus, OkResult};
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
struct GitCommitFileInput {
    filename: String,
    message: String,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct GitDiscardFileInput {
    filename: String,
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

async fn commit_file(ctx: OrpcCtx, input: GitCommitFileInput) -> Result<CommitResult, ORPCError> {
    git::commit_single_file(ctx.app, input.filename, input.message)
        .await
        .map_err(|error| internal_err("git.commitFile", error))
}

async fn discard_file(ctx: OrpcCtx, input: GitDiscardFileInput) -> Result<OkResult, ORPCError> {
    git::discard_single_file(ctx.app, input.filename)
        .await
        .map_err(|error| internal_err("git.discardFile", error))
}

async fn file_diff_contents(
    ctx: OrpcCtx,
    input: GitFileDiffContentsInput,
) -> Result<HashMap<String, FileDiffContents>, ORPCError> {
    git::fetch_file_diff_contents(ctx.app, input.filenames)
        .await
        .map_err(|error| internal_err("git.fileDiffContents", error))
}

async fn state(ctx: OrpcCtx, _input: ()) -> Result<GitState, ORPCError> {
    git::get_git_state(ctx.app)
        .await
        .map_err(|error| internal_err("git.state", error))
}

async fn status(ctx: OrpcCtx, _input: ()) -> Result<GitStatus, ORPCError> {
    git::git_status(ctx.app)
        .await
        .map_err(|error| internal_err("git.status", error))
}

async fn status_and_cache(ctx: OrpcCtx, _input: ()) -> Result<GitStatus, ORPCError> {
    git::git_status_and_cache(ctx.app)
        .await
        .map_err(|error| internal_err("git.statusAndCache", error))
}

async fn pull_from_upstream(ctx: OrpcCtx, _input: ()) -> Result<OkResult, ORPCError> {
    git::pull_from_upstream(ctx.app)
        .await
        .map_err(|error| internal_err("git.pullFromUpstream", error))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "commit" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<GitCommitInput>())
            .output(orpc_specta::specta::<CommitResult>())
            .handler(commit),
        "commitFile" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<GitCommitFileInput>())
            .output(orpc_specta::specta::<CommitResult>())
            .handler(commit_file),
        "discardFile" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<GitDiscardFileInput>())
            .output(orpc_specta::specta::<OkResult>())
            .handler(discard_file),
        "fileDiffContents" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<GitFileDiffContentsInput>())
            .output(orpc_specta::specta::<HashMap<String, FileDiffContents>>())
            .handler(file_diff_contents),
        "state" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<GitState>())
            .handler(state),
        "status" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<GitStatus>())
            .handler(status),
        "statusAndCache" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<GitStatus>())
            .handler(status_and_cache),
        "pullFromUpstream" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<OkResult>())
            .handler(pull_from_upstream),
    }
}
