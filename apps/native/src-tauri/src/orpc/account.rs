//! nixmac account authentication and sync server configuration.

use super::{OrpcCtx, helpers::internal_err};
use crate::commands::account as cmd;
use crate::shared_types::AuthStatus;
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct SignInInput {
    email: String,
    password: String,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct SignUpWebInput {
    name: String,
    email: String,
    password: String,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct SendOtpInput {
    email: String,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct VerifyOtpInput {
    email: String,
    otp: String,
    name: String,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct SetServerUrlInput {
    url: String,
}

async fn status(ctx: OrpcCtx, _input: ()) -> Result<AuthStatus, ORPCError> {
    cmd::account_status(ctx.app)
        .await
        .map_err(|e| internal_err("account.status", e))
}

async fn sign_in(ctx: OrpcCtx, input: SignInInput) -> Result<AuthStatus, ORPCError> {
    cmd::account_sign_in(ctx.app, input.email, input.password)
        .await
        .map_err(|e| internal_err("account.signIn", e))
}

async fn sign_in_web(ctx: OrpcCtx, input: SignInInput) -> Result<AuthStatus, ORPCError> {
    cmd::account_sign_in_web(ctx.app, input.email, input.password)
        .await
        .map_err(|e| internal_err("account.signInWeb", e))
}

async fn sign_up_web(ctx: OrpcCtx, input: SignUpWebInput) -> Result<AuthStatus, ORPCError> {
    cmd::account_sign_up_web(ctx.app, input.name, input.email, input.password)
        .await
        .map_err(|e| internal_err("account.signUpWeb", e))
}

async fn send_otp(_ctx: OrpcCtx, input: SendOtpInput) -> Result<(), ORPCError> {
    cmd::account_send_otp(input.email)
        .await
        .map_err(|e| internal_err("account.sendOtp", e))
}

async fn verify_otp(ctx: OrpcCtx, input: VerifyOtpInput) -> Result<AuthStatus, ORPCError> {
    cmd::account_verify_otp(ctx.app, input.email, input.otp, input.name)
        .await
        .map_err(|e| internal_err("account.verifyOtp", e))
}

async fn sign_out(ctx: OrpcCtx, _input: ()) -> Result<AuthStatus, ORPCError> {
    cmd::account_sign_out(ctx.app)
        .await
        .map_err(|e| internal_err("account.signOut", e))
}

async fn set_server_url(ctx: OrpcCtx, input: SetServerUrlInput) -> Result<AuthStatus, ORPCError> {
    cmd::account_set_server_url(ctx.app, input.url)
        .await
        .map_err(|e| internal_err("account.setServerUrl", e))
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "status" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<AuthStatus>())
            .handler(status),
        "signIn" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<SignInInput>())
            .output(orpc_specta::specta::<AuthStatus>())
            .handler(sign_in),
        "signInWeb" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<SignInInput>())
            .output(orpc_specta::specta::<AuthStatus>())
            .handler(sign_in_web),
        "signUpWeb" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<SignUpWebInput>())
            .output(orpc_specta::specta::<AuthStatus>())
            .handler(sign_up_web),
        "sendOtp" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<SendOtpInput>())
            .handler(send_otp),
        "verifyOtp" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<VerifyOtpInput>())
            .output(orpc_specta::specta::<AuthStatus>())
            .handler(verify_otp),
        "signOut" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<AuthStatus>())
            .handler(sign_out),
        "setServerUrl" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<SetServerUrlInput>())
            .output(orpc_specta::specta::<AuthStatus>())
            .handler(set_server_url),
    }
}
