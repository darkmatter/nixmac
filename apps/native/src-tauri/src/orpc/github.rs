//! GitHub App connection procedures (server-brokered via `crate::sync`).

use super::OrpcCtx;
use crate::shared_types::{GithubBootstrapStatus, GithubConnectStart, GithubRepo, GithubStatus};
use crate::sync;
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct GithubBootstrapStatusInput {
    state: String,
}

fn github_err(cmd: &str, error: impl std::fmt::Display) -> ORPCError {
    tracing::error!(command = cmd, error = %error, "orpc error");
    ORPCError::internal_server_error(error.to_string())
}

async fn bootstrap_start(_ctx: OrpcCtx, _input: ()) -> Result<GithubConnectStart, ORPCError> {
    sync::github_bootstrap_start()
        .await
        .map_err(|error| github_err("github.bootstrapStart", error))
}

async fn bootstrap_status(
    ctx: OrpcCtx,
    input: GithubBootstrapStatusInput,
) -> Result<GithubBootstrapStatus, ORPCError> {
    sync::github_bootstrap_status(&ctx.app, &input.state)
        .await
        .map_err(|error| github_err("github.bootstrapStatus", error))
}

async fn connect_start(ctx: OrpcCtx, _input: ()) -> Result<GithubConnectStart, ORPCError> {
    sync::github_connect_start(&ctx.app)
        .await
        .map_err(|error| github_err("github.connectStart", error))
}

async fn status(ctx: OrpcCtx, _input: ()) -> Result<GithubStatus, ORPCError> {
    sync::github_status(&ctx.app)
        .await
        .map_err(|error| github_err("github.status", error))
}

async fn list_repos(ctx: OrpcCtx, _input: ()) -> Result<Vec<GithubRepo>, ORPCError> {
    sync::github_list_repos(&ctx.app)
        .await
        .map_err(|error| github_err("github.listRepos", error))
}

async fn disconnect(ctx: OrpcCtx, _input: ()) -> Result<(), ORPCError> {
    sync::github_disconnect(&ctx.app)
        .await
        .map_err(|error| github_err("github.disconnect", error))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "github" => {
            "bootstrapStart" => os::<OrpcCtx>()
                .output(orpc_specta::specta::<GithubConnectStart>())
                .handler(bootstrap_start),
            "bootstrapStatus" => os::<OrpcCtx>()
                .input(orpc_specta::specta::<GithubBootstrapStatusInput>())
                .output(orpc_specta::specta::<GithubBootstrapStatus>())
                .handler(bootstrap_status),
            "connectStart" => os::<OrpcCtx>()
                .output(orpc_specta::specta::<GithubConnectStart>())
                .handler(connect_start),
            "status" => os::<OrpcCtx>()
                .output(orpc_specta::specta::<GithubStatus>())
                .handler(status),
            "listRepos" => os::<OrpcCtx>()
                .output(orpc_specta::specta::<Vec<GithubRepo>>())
                .handler(list_repos),
            "disconnect" => os::<OrpcCtx>()
                .handler(disconnect),
        },
    }
}
