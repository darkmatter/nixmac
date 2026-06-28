//! Billing procedures (Polar, server-brokered via `crate::sync`).

use super::{OrpcCtx, helpers::internal_err};
use crate::shared_types::AccountBilling;
use crate::sync::{self, BillingProductInfo};
use orpc::*;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct CheckoutInput {
    product: String,
}

#[derive(Debug, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct CheckoutUrl {
    url: String,
}

async fn state(ctx: OrpcCtx, _input: ()) -> Result<AccountBilling, ORPCError> {
    sync::account_billing(&ctx.app)
        .await
        .map_err(|error| internal_err("billing.state", error))
}

async fn products(ctx: OrpcCtx, _input: ()) -> Result<Vec<BillingProductInfo>, ORPCError> {
    sync::billing_products(&ctx.app)
        .await
        .map_err(|error| internal_err("billing.products", error))
}

async fn checkout(ctx: OrpcCtx, input: CheckoutInput) -> Result<CheckoutUrl, ORPCError> {
    let url = sync::create_checkout(&ctx.app, &input.product)
        .await
        .map_err(|error| internal_err("billing.checkout", error))?;
    Ok(CheckoutUrl { url })
}

async fn portal(ctx: OrpcCtx, _input: ()) -> Result<CheckoutUrl, ORPCError> {
    let url = sync::create_billing_portal(&ctx.app)
        .await
        .map_err(|error| internal_err("billing.portal", error))?;
    Ok(CheckoutUrl { url })
}

pub fn routes() -> Router<OrpcCtx> {
    router! {
        "state" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<AccountBilling>())
            .handler(state),
        "products" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<Vec<BillingProductInfo>>())
            .handler(products),
        "checkout" => os::<OrpcCtx>()
            .input(orpc_specta::specta::<CheckoutInput>())
            .output(orpc_specta::specta::<CheckoutUrl>())
            .handler(checkout),
        "portal" => os::<OrpcCtx>()
            .output(orpc_specta::specta::<CheckoutUrl>())
            .handler(portal),
    }
}
