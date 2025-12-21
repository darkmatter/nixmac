import { checkout, polar } from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";
import { betterAuth } from "better-auth";

const polarClient = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
});

const auth = betterAuth({
  // ... Better Auth config
  plugins: [
    polar({
      client: polarClient,
      createCustomerOnSignUp: true,
      use: [
        checkout({
          products: [
            {
              productId: "2076d265-fc33-4390-9184-2b1d0c10b679",
              slug: "Premium", // Custom slug for easy reference in Checkout URL, e.g. /checkout/Premium
            },
            {
              productId: "e0b976a8-8ccd-4624-b360-12abd2882394",
              slug: "Free", // Custom slug for easy reference in Checkout URL, e.g. /checkout/Free
            },
          ],
          successUrl: process.env.POLAR_SUCCESS_URL,
          authenticatedUsersOnly: true,
        }),
      ],
    }),
  ],
});
