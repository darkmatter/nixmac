import { polarClient } from "@polar-sh/better-auth";
import { createAuthClient } from "better-auth/react";

// biome-ignore lint/suspicious/noExplicitAny: Version mismatch with @polar-sh/better-auth
const polarPlugin = polarClient() as any;

const baseAuthClient = createAuthClient({
  baseURL: import.meta.env.VITE_SERVER_URL,
  plugins: [polarPlugin],
});

// Re-export with proper typing for Polar plugin methods
export const authClient = baseAuthClient as typeof baseAuthClient & {
  customer: {
    state: () => Promise<{ data: { activeSubscriptions?: unknown[] } | null }>;
    portal: () => Promise<unknown>;
  };
  checkout: (options: { slug: string }) => Promise<unknown>;
};
