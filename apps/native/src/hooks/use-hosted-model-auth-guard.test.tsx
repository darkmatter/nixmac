import { useHostedModelAuthGuard } from "@/hooks/use-hosted-model-auth-guard";
import { makeCompletedOnboardingState, makeGlobalPreferences } from "@/utils/test-fixtures";
import { viewModelActions } from "@nixmac/state";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type AccountStatus = {
  signedIn: boolean;
  account: { id: string; email: string } | null;
  webApiAuthReady: boolean;
};

const ACCOUNT_STATUS_QUERY_KEY = ["account", "status"] as const;

const { accountStatus, openSettings } = vi.hoisted(() => ({
  accountStatus: vi.fn<() => Promise<AccountStatus>>(),
  openSettings: vi.fn<(tab: string, prompt: string) => void>(),
}));

vi.mock("@/lib/orpc", () => ({
  orpc: {
    account: {
      status: {
        queryOptions: (options: Record<string, unknown> = {}) => ({
          queryKey: ["account", "status"],
          queryFn: accountStatus,
          ...options,
        }),
      },
    },
  },
}));

vi.mock("@/router", () => ({
  nav: {
    openSettings,
  },
}));

function makeAccountStatus(webApiAuthReady: boolean): AccountStatus {
  return {
    signedIn: webApiAuthReady,
    account: webApiAuthReady ? { id: "account-1", email: "ada@example.com" } : null,
    webApiAuthReady,
  };
}

function renderGuard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const hook = renderHook(() => useHostedModelAuthGuard(), {
    wrapper: ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });

  return { ...hook, queryClient };
}

describe("useHostedModelAuthGuard", () => {
  beforeEach(() => {
    accountStatus.mockReset();
    openSettings.mockReset();
    accountStatus.mockResolvedValue(makeAccountStatus(false));
    viewModelActions.setState({
      hydrated: true,
      onboardingState: makeCompletedOnboardingState(),
      preferences: makeGlobalPreferences({ evolveProvider: "nixmac" }),
    });
  });

  it("waits for auth status before prompting for hosted-model sign-in", async () => {
    let resolveStatus: ((status: AccountStatus) => void) | undefined;
    accountStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );

    renderGuard();

    expect(openSettings).not.toHaveBeenCalled();

    await act(async () => {
      resolveStatus?.(makeAccountStatus(false));
    });

    await waitFor(() => {
      expect(openSettings).toHaveBeenCalledWith("ai-models", "hosted-auth");
    });
  });

  it("does not prompt when the hosted-model credential is ready", async () => {
    const status = makeAccountStatus(true);
    accountStatus.mockResolvedValue(status);
    const { queryClient } = renderGuard();

    await waitFor(() => {
      expect(queryClient.getQueryData(ACCOUNT_STATUS_QUERY_KEY)).toEqual(status);
    });
    expect(openSettings).not.toHaveBeenCalled();
  });

  it("checks reactively when hosted inference is selected after mount", async () => {
    viewModelActions.setState({
      preferences: makeGlobalPreferences({
        evolveProvider: "openrouter",
        summaryProvider: "ollama",
      }),
    });
    renderGuard();

    expect(accountStatus).not.toHaveBeenCalled();

    act(() => {
      viewModelActions.setState({
        preferences: makeGlobalPreferences({ evolveProvider: "nixmac" }),
      });
    });

    await waitFor(() => {
      expect(openSettings).toHaveBeenCalledWith("ai-models", "hosted-auth");
    });
  });

  it("reacts when the shared account status changes to signed out", async () => {
    const readyStatus = makeAccountStatus(true);
    accountStatus.mockResolvedValue(readyStatus);
    const { queryClient } = renderGuard();

    await waitFor(() => {
      expect(queryClient.getQueryData(ACCOUNT_STATUS_QUERY_KEY)).toEqual(readyStatus);
    });

    act(() => {
      queryClient.setQueryData(ACCOUNT_STATUS_QUERY_KEY, makeAccountStatus(false));
    });

    await waitFor(() => {
      expect(openSettings).toHaveBeenCalledWith("ai-models", "hosted-auth");
    });
  });
});
