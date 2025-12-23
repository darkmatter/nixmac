import { db } from "@nixmac/db";
// biome-ignore lint/performance/noNamespaceImport: <explanation>
import * as schema from "@nixmac/db/schema/auth";
import { env } from "@nixmac/env/web";
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
      successUrl: env.POLAR_SUCCESS_URL as string,
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
  trustedOrigins: [String(env.CORS_ORIGIN || "")],
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
