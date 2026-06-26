import { tauriFetchImpl } from "@daveyplate/better-auth-tauri";
import { getWebSiteUrl } from "@/lib/env";
import { createAuthClient } from "better-auth/react";

export const auth = createAuthClient({
  baseURL: getWebSiteUrl(),
  fetchOptions: {
    customFetchImpl: tauriFetchImpl,
  },
});