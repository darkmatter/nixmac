//! System-level inspection procedures.

use super::OrpcCtx;
use crate::shared_types::InstallLocationState;
use crate::system::install_location;
use orpc::*;

async fn install_location(_ctx: OrpcCtx, _input: ()) -> Result<InstallLocationState, ORPCError> {
    Ok(install_location::check_install_location())
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "installLocation" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<InstallLocationState>())
            .handler(install_location),
    }
}
