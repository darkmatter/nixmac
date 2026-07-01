//! Auto-update channel check, install, relaunch, and version pinning.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::updater as cmd;
use crate::shared_types::UpdateInfo;
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct InstallVersionInput {
    version: String,
}

async fn check_update(ctx: OrpcCtx, _input: ()) -> Result<Option<UpdateInfo>, ORPCError> {
    cmd::check_update(ctx.app)
        .await
        .map_err(|e| internal_err("updater.checkUpdate", e))
}

async fn install_update(ctx: OrpcCtx, _input: ()) -> Result<(), ORPCError> {
    cmd::install_update(ctx.app)
        .await
        .map_err(|e| internal_err("updater.installUpdate", e))
}

async fn install_version(ctx: OrpcCtx, input: InstallVersionInput) -> Result<(), ORPCError> {
    cmd::install_version(ctx.app, input.version)
        .await
        .map_err(|e| internal_err("updater.installVersion", e))
}

async fn relaunch(ctx: OrpcCtx, _input: ()) -> Result<(), ORPCError> {
    // `relaunch_after_update` is sync; run it directly. It schedules an app
    // exit through the Tauri event loop and returns immediately.
    cmd::relaunch_after_update(ctx.app).map_err(|e| internal_err("updater.relaunch", e))
}

async fn clear_pinned_version(ctx: OrpcCtx, _input: ()) -> Result<(), ORPCError> {
    cmd::clear_pinned_version(ctx.app)
        .await
        .map_err(|e| internal_err("updater.clearPinnedVersion", e))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "checkUpdate" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<Option<UpdateInfo>>())
            .handler(check_update),
        "installUpdate" => os::<OrpcCtx>()
            .handler(install_update),
        "installVersion" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<InstallVersionInput>())
            .handler(install_version),
        "relaunch" => os::<OrpcCtx>()
            .handler(relaunch),
        "clearPinnedVersion" => os::<OrpcCtx>()
            .handler(clear_pinned_version),
    }
}
