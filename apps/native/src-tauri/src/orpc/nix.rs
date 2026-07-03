//! Nix installation state and availability checks.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::apply as cmd;
use crate::shared_types::{NixCheckResult, NixInstallState};
use orpc::*;

async fn check(ctx: OrpcCtx, _input: ()) -> Result<NixCheckResult, ORPCError> {
    cmd::nix_check(ctx.app)
        .await
        .map_err(|e| internal_err("nix.check", e))
}

async fn install_state(ctx: OrpcCtx, _input: ()) -> Result<NixInstallState, ORPCError> {
    cmd::get_nix_install_state(ctx.app)
        .await
        .map_err(|e| internal_err("nix.installState", e))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "check" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<NixCheckResult>())
            .handler(check),
        "installState" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<NixInstallState>())
            .handler(install_state),
    }
}
