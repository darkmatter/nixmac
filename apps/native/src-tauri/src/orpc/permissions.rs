//! macOS permissions probing and requests.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::permissions as cmd;
use crate::shared_types::{Permission, PermissionsState};
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct RequestInput {
    permission_id: String,
}

async fn get(ctx: OrpcCtx, _input: ()) -> Result<Option<PermissionsState>, ORPCError> {
    cmd::get_permissions(ctx.app)
        .await
        .map_err(|e| internal_err("permissions.get", e))
}

async fn refresh(ctx: OrpcCtx, _input: ()) -> Result<(), ORPCError> {
    cmd::refresh_permissions(ctx.app)
        .await
        .map_err(|e| internal_err("permissions.refresh", e))
}

async fn request(_ctx: OrpcCtx, input: RequestInput) -> Result<Permission, ORPCError> {
    cmd::permissions_request(input.permission_id)
        .await
        .map_err(|e| internal_err("permissions.request", e))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "get" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<Option<PermissionsState>>())
            .handler(get),
        "refresh" => os::<OrpcCtx>()
            .handler(refresh),
        "request" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<RequestInput>())
            .output(orpc_specta::specta::<Permission>())
            .handler(request),
    }
}
