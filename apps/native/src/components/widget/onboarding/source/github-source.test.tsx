import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GitHubSource } from "@/components/widget/onboarding/source/github-source";

type AccountStatus = { githubReady: boolean };
type GithubStart = { installUrl: string; state: string };
type GithubBootstrapStatus = { state: string; connected: boolean };
type GithubStatus = { connected: boolean; login: string | null; installationId: number | null };
type SignInSocialInput = { authClient: unknown; provider: "github" };

const mockAccountStatus = vi.fn<() => Promise<AccountStatus>>();
const mockBootstrapStart = vi.fn<() => Promise<GithubStart>>();
const mockBootstrapStatus = vi.fn<(input: { state: string }) => Promise<GithubBootstrapStatus>>();
const mockConnectStart = vi.fn<() => Promise<GithubStart>>();
const mockGitHubStatus = vi.fn<() => Promise<GithubStatus>>();
const mockListRepos = vi.fn<() => Promise<never[]>>();
const mockImport = vi.fn<(owner: string, repo: string, dirName?: string) => Promise<void>>();
const mockOpen = vi.fn<(url: string) => Promise<void>>();
const mockSignInSocial = vi.fn<(input: SignInSocialInput) => Promise<void>>();
const mockAuthClient = vi.hoisted(() => ({}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    account: {
      status: () => mockAccountStatus(),
      sendOtp: vi.fn<() => void>(),
      verifyOtp: vi.fn<() => void>(),
    },
    github: {
      import: (owner: string, repo: string, dirName?: string) => mockImport(owner, repo, dirName),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: mockAuthClient,
}));

vi.mock("@/lib/orpc", () => ({
  client: {
    github: {
      bootstrapStart: () => mockBootstrapStart(),
      bootstrapStatus: (input: { state: string }) => mockBootstrapStatus(input),
      connectStart: () => mockConnectStart(),
      status: () => mockGitHubStatus(),
      listRepos: () => mockListRepos(),
    },
  },
}));

vi.mock("@daveyplate/better-auth-tauri", () => ({
  signInSocial: (input: SignInSocialInput) => mockSignInSocial(input),
}));

vi.mock("@daveyplate/better-auth-tauri/react", () => ({
  useBetterAuthTauri: vi.fn<(input: unknown) => void>(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: (url: string) => mockOpen(url),
}));

describe("GitHubSource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccountStatus.mockResolvedValue({ githubReady: false });
    mockBootstrapStart.mockResolvedValue({
      installUrl: "https://github.com/apps/nixmac/installations/new?state=state-1",
      state: "state-1",
    });
    mockBootstrapStatus.mockResolvedValue({ state: "pending", connected: false });
    mockConnectStart.mockResolvedValue({
      installUrl: "https://github.com/apps/nixmac/installations/new?state=state-2",
      state: "state-2",
    });
    mockGitHubStatus.mockResolvedValue({ connected: false, login: null, installationId: null });
    mockListRepos.mockResolvedValue([]);
    mockImport.mockResolvedValue(undefined);
    mockOpen.mockResolvedValue(undefined);
    mockSignInSocial.mockResolvedValue(undefined);
  });

  it("starts GitHub auth through Better Auth Tauri social sign-in", async () => {
    render(<GitHubSource />);

    const connectButton = await screen.findByTestId("github-connect-button");
    await act(async () => {
      fireEvent.click(connectButton);
    });

    await waitFor(() =>
      expect(mockSignInSocial).toHaveBeenCalledWith({
        authClient: mockAuthClient,
        provider: "github",
      }),
    );
    expect(mockBootstrapStart).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
  });
});
