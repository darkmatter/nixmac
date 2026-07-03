//! Configurable registry access for the dev-settings auto-UI.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::dev_configs as cmd;
use configurable::ConfigurableSchema;
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct SetInput {
    struct_name: String,
    value: serde_json::Value,
}

async fn schemas(ctx: OrpcCtx, _input: ()) -> Result<Vec<ConfigurableSchema>, ORPCError> {
    cmd::dev_configs_schemas(ctx.app)
        .await
        .map_err(|e| internal_err("devConfigs.schemas", e))
}

async fn values(ctx: OrpcCtx, _input: ()) -> Result<HashMap<String, serde_json::Value>, ORPCError> {
    cmd::dev_configs_values(ctx.app)
        .await
        .map_err(|e| internal_err("devConfigs.values", e))
}

async fn set(ctx: OrpcCtx, input: SetInput) -> Result<(), ORPCError> {
    cmd::dev_config_set(ctx.app, input.struct_name, input.value)
        .await
        .map_err(|e| internal_err("devConfigs.set", e))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "schemas" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<Vec<ConfigurableSchema>>())
            .handler(schemas),
        "values" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<HashMap<String, serde_json::Value>>())
            .handler(values),
        "set" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<SetInput>())
            .handler(set),
    }
}
