import { auth as authClient } from "@/lib/auth";
import { orpc } from "@/lib/orpc";
import { useBetterAuthTauri } from "@daveyplate/better-auth-tauri/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

const AUTH_DEEP_LINK_SCHEME = "nixmac";

export const AUTH_DEEP_LINK_SUCCESS_EVENT = "nixmac:auth-deep-link-success";
export const AUTH_DEEP_LINK_ERROR_EVENT = "nixmac:auth-deep-link-error";

export type AuthDeepLinkErrorDetail = {
  message?: string;
  statusText?: string;
};

/** Register Better Auth OAuth deep-link handling for the app lifetime. */
export function useAuthDeepLink(): void {
  const queryClient = useQueryClient();

  const onSuccess = useCallback(
    (callbackURL?: string | null) => {
      void queryClient.invalidateQueries({ queryKey: orpc.github.key() });
      window.dispatchEvent(
        new CustomEvent(AUTH_DEEP_LINK_SUCCESS_EVENT, { detail: { callbackURL } }),
      );
    },
    [queryClient],
  );

  const onError = useCallback((error: { message?: string; statusText?: string }) => {
    console.error("Auth error:", error);
    window.dispatchEvent(
      new CustomEvent<AuthDeepLinkErrorDetail>(AUTH_DEEP_LINK_ERROR_EVENT, {
        detail: {
          message: error.message,
          statusText: error.statusText,
        },
      }),
    );
  }, []);

  useBetterAuthTauri({
    authClient,
    scheme: AUTH_DEEP_LINK_SCHEME,
    debugLogs: import.meta.env.DEV,
    onSuccess,
    onError,
  });
}
