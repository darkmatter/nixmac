//! Evolve routing state (`get` / `clear`) — parallel to `commands::evolve_state`.

use super::OrpcCtx;
use crate::commands::evolve_state;
use crate::shared_types::EvolveState;
use orpc::*;

fn evolve_state_err(cmd: &str, error: impl std::fmt::Display) -> ORPCError {
    tracing::error!(command = cmd, error = %error, "orpc error");
    ORPCError::internal_server_error(error.to_string())
}

async fn get(ctx: OrpcCtx, _input: ()) -> Result<EvolveState, ORPCError> {
    evolve_state::fetch_evolve_state(ctx.app)
        .await
        .map_err(|error| evolve_state_err("evolveState.get", error))
}

async fn clear(ctx: OrpcCtx, _input: ()) -> Result<EvolveState, ORPCError> {
    evolve_state::reset_evolve_state(ctx.app)
        .await
        .map_err(|error| evolve_state_err("evolveState.clear", error))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "get" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<EvolveState>())
            .handler(get),
        "clear" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<EvolveState>())
            .handler(clear),
    }
}
