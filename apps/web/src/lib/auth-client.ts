import type { auth } from "@nixmac/auth";
import { createAuthClient } from "better-auth/react";
import { polarClient } from "@polar-sh/better-auth";

export const authClient = createAuthClient({
	baseURL: import.meta.env.VITE_SERVER_URL,
	plugins: [polarClient()],
});
