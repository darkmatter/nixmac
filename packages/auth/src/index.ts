import { db } from "@nixmac/db";
import * as schema from "@nixmac/db/schema/auth";
import { checkout, polar, portal } from "@polar-sh/better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { polarClient } from "./lib/payments";

// biome-ignore lint/suspicious/noExplicitAny: Version mismatch with @polar-sh/better-auth
const polarPlugin = polar({
  client: polarClient,
  createCustomerOnSignUp: true,
  enableCustomerPortal: true,
  use: [
    checkout({
      products: [
        {
          productId: "your-product-id",
          slug: "pro",
        },
      ],
      successUrl: process.env.POLAR_SUCCESS_URL,
      authenticatedUsersOnly: true,
    }),
    portal(),
  ],
}) as any as BetterAuthPlugin;

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",

    schema,
  }),
  trustedOrigins: [process.env.CORS_ORIGIN || ""],
  emailAndPassword: {
    enabled: true,
  },
  advanced: {
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
      httpOnly: true,
    },
  },
  plugins: [polarPlugin],
});
