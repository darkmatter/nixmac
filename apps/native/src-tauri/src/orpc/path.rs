//! Path normalization and existence checks.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::config;
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct PathExistsInput {
    dir: String,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct PathNormalizeInput {
    input: String,
}

async fn exists(_ctx: OrpcCtx, input: PathExistsInput) -> Result<bool, ORPCError> {
    config::path_exists(input.dir)
        .await
        .map_err(|error| internal_err("path.exists", error))
}

async fn normalize(_ctx: OrpcCtx, input: PathNormalizeInput) -> Result<String, ORPCError> {
    config::path_normalize(input.input)
        .await
        .map_err(|error| internal_err("path.normalize", error))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "exists" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<PathExistsInput>())
            .output(orpc_specta::specta::<bool>())
            .handler(exists),
        "normalize" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<PathNormalizeInput>())
            .output(orpc_specta::specta::<String>())
            .handler(normalize),
    }
}
