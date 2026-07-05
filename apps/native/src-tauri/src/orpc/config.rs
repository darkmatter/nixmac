//! Configuration directory and import procedures.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::config;
use crate::shared_types::{ImportConfigResult, OkResult, SetDirResult};
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct ConfigSetHostAttrInput {
    host: String,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct ConfigSetDirInput {
    dir: String,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct ConfigImportGithubInput {
    repo_ref: String,
    dir_name: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct ConfigImportZipInput {
    zip_path: String,
    dir_name: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct ConfigCreateFromTemplateInput {
    /// Repository reference for the template, e.g. `github:owner/repo?dir=templates/mac`.
    template_ref: String,
    hostname: String,
    dir_name: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct ConfigFinalizeImportInput {
    clone_dir: String,
    /// Relative flake directory inside `clone_dir`; empty for the root.
    flake_dir: String,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct ConfigDiscardImportInput {
    dir: String,
}

async fn get(ctx: OrpcCtx, _input: ()) -> Result<crate::shared_types::Config, ORPCError> {
    config::config_get(ctx.app)
        .await
        .map_err(|error| internal_err("config.get", error))
}

async fn get_this_hostname(_ctx: OrpcCtx, _input: ()) -> Result<String, ORPCError> {
    config::get_this_hostname()
        .await
        .map_err(|error| internal_err("config.getThisHostname", error))
}

async fn set_host_attr(ctx: OrpcCtx, input: ConfigSetHostAttrInput) -> Result<OkResult, ORPCError> {
    config::config_set_host_attr(ctx.app, input.host)
        .await
        .map_err(|error| internal_err("config.setHostAttr", error))
}

async fn set_dir(ctx: OrpcCtx, input: ConfigSetDirInput) -> Result<SetDirResult, ORPCError> {
    config::config_set_dir(ctx.app, input.dir)
        .await
        .map_err(|error| internal_err("config.setDir", error))
}

async fn prepare_new_dir(
    ctx: OrpcCtx,
    input: ConfigSetDirInput,
) -> Result<SetDirResult, ORPCError> {
    config::config_prepare_new_dir(ctx.app, input.dir)
        .await
        .map_err(|error| internal_err("config.prepareNewDir", error))
}

async fn pick_dir(ctx: OrpcCtx, _input: ()) -> Result<Option<SetDirResult>, ORPCError> {
    config::config_pick_dir(ctx.app)
        .await
        .map_err(|error| internal_err("config.pickDir", error))
}

async fn pick_folder(ctx: OrpcCtx, _input: ()) -> Result<Option<String>, ORPCError> {
    config::config_pick_folder(ctx.app)
        .await
        .map_err(|error| internal_err("config.pickFolder", error))
}

async fn pick_zip(ctx: OrpcCtx, _input: ()) -> Result<Option<String>, ORPCError> {
    config::config_pick_zip(ctx.app)
        .await
        .map_err(|error| internal_err("config.pickZip", error))
}

async fn import_github(
    ctx: OrpcCtx,
    input: ConfigImportGithubInput,
) -> Result<ImportConfigResult, ORPCError> {
    config::config_import_github(ctx.app, input.repo_ref, input.dir_name)
        .await
        .map_err(|error| internal_err("config.importGithub", error))
}

async fn import_zip(
    ctx: OrpcCtx,
    input: ConfigImportZipInput,
) -> Result<ImportConfigResult, ORPCError> {
    config::config_import_zip(ctx.app, input.zip_path, input.dir_name)
        .await
        .map_err(|error| internal_err("config.importZip", error))
}

async fn create_from_template(
    ctx: OrpcCtx,
    input: ConfigCreateFromTemplateInput,
) -> Result<SetDirResult, ORPCError> {
    config::config_create_from_template(ctx.app, input.template_ref, input.hostname, input.dir_name)
        .await
        .map_err(|error| internal_err("config.createFromTemplate", error))
}

async fn finalize_import(
    ctx: OrpcCtx,
    input: ConfigFinalizeImportInput,
) -> Result<ImportConfigResult, ORPCError> {
    config::config_finalize_import(ctx.app, input.clone_dir, input.flake_dir)
        .await
        .map_err(|error| internal_err("config.finalizeImport", error))
}

async fn discard_import(
    ctx: OrpcCtx,
    input: ConfigDiscardImportInput,
) -> Result<OkResult, ORPCError> {
    config::config_discard_import(ctx.app, input.dir)
        .await
        .map_err(|error| internal_err("config.discardImport", error))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "get" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<crate::shared_types::Config>())
            .handler(get),
        "getThisHostname" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<String>())
            .handler(get_this_hostname),
        "setHostAttr" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<ConfigSetHostAttrInput>())
            .output(orpc_specta::specta::<OkResult>())
            .handler(set_host_attr),
        "setDir" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<ConfigSetDirInput>())
            .output(orpc_specta::specta::<SetDirResult>())
            .handler(set_dir),
        "prepareNewDir" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<ConfigSetDirInput>())
            .output(orpc_specta::specta::<SetDirResult>())
            .handler(prepare_new_dir),
        "pickDir" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<Option<SetDirResult>>())
            .handler(pick_dir),
        "pickFolder" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<Option<String>>())
            .handler(pick_folder),
        "pickZip" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<Option<String>>())
            .handler(pick_zip),
        "importGithub" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<ConfigImportGithubInput>())
            .output(orpc_specta::specta::<ImportConfigResult>())
            .handler(import_github),
        "importZip" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<ConfigImportZipInput>())
            .output(orpc_specta::specta::<ImportConfigResult>())
            .handler(import_zip),
        "createFromTemplate" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<ConfigCreateFromTemplateInput>())
            .output(orpc_specta::specta::<SetDirResult>())
            .handler(create_from_template),
        "finalizeImport" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<ConfigFinalizeImportInput>())
            .output(orpc_specta::specta::<ImportConfigResult>())
            .handler(finalize_import),
        "discardImport" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<ConfigDiscardImportInput>())
            .output(orpc_specta::specta::<OkResult>())
            .handler(discard_import),
    }
}
