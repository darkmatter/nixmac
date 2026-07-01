//! Device-wide global preferences (user-tier settings).

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::ui_prefs as cmd;
use crate::state::preferences::GlobalPreferences;
use orpc::*;

async fn get(ctx: OrpcCtx, _input: ()) -> Result<GlobalPreferences, ORPCError> {
    cmd::get_global_preferences(ctx.app)
        .await
        .map_err(|e| internal_err("preferences.get", e))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "get" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<GlobalPreferences>())
            .handler(get),
    }
}
