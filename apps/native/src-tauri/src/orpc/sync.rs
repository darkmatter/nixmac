//! Remote configuration sync (push/pull) against the nixmac sync server.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::account as cmd;
use crate::shared_types::{SyncRemoteStatus, SyncResult};
use orpc::*;

async fn status(ctx: OrpcCtx, _input: ()) -> Result<SyncRemoteStatus, ORPCError> {
    cmd::sync_status(ctx.app)
        .await
        .map_err(|e| internal_err("sync.status", e))
}

async fn push(ctx: OrpcCtx, _input: ()) -> Result<SyncResult, ORPCError> {
    cmd::sync_push(ctx.app)
        .await
        .map_err(|e| internal_err("sync.push", e))
}

async fn pull(ctx: OrpcCtx, _input: ()) -> Result<SyncResult, ORPCError> {
    cmd::sync_pull(ctx.app)
        .await
        .map_err(|e| internal_err("sync.pull", e))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "status" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<SyncRemoteStatus>())
            .handler(status),
        "push" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<SyncResult>())
            .handler(push),
        "pull" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<SyncResult>())
            .handler(pull),
    }
}
