import { tauriFetchImpl } from "@daveyplate/better-auth-tauri";
import { createAuthClient } from "better-auth/react";
import { getWebSiteUrl } from "@/lib/env";

export const auth = createAuthClient({
  baseURL: getWebSiteUrl(),
  fetchOptions: {
    customFetchImpl: tauriFetchImpl,
  },
});
