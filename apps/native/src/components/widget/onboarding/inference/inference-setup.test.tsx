import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InferenceSetup } from "@/components/widget/onboarding/inference/inference-setup";
import type { AccountBilling, BillingProductInfo } from "@/lib/orpc";

type AuthStatus = {
  signedIn: boolean;
  account: { email: string };
  credentialId: string;
};

type AccountStatus = {
  signedIn: boolean;
  account: { id: string; email: string } | null;
  keyId: string | null;
  serverUrl: string;
  githubReady: boolean;
  webAccount: { id: string; email: string } | null;
};

const emptyBilling: AccountBilling = {
  usage: { currency: "USD", spentUsd: 0 },
  subscriptions: [],
  hasPaymentMethod: false,
  canUseHostedInference: false,
  canUseDeviceSync: false,
};

const demoProducts: BillingProductInfo[] = [
  {
    product: "credits",
    name: "Hosted inference credits",
    currency: "usd",
    type: "subscription",
  },
  {
    product: "pro",
    name: "Pro",
    currency: "usd",
    type: "subscription",
    priceUsd: 5,
    recurringInterval: "month",
  },
];

type CheckoutInput = { product: string };

const mocks = vi.hoisted(() => ({
  status: vi.fn<() => Promise<AccountStatus>>(),
  sendOtp: vi.fn<(email: string) => Promise<void>>(),
  verifyOtp: vi.fn<(email: string, otp: string, name: string) => Promise<AuthStatus>>(),
  billingState: vi.fn<() => Promise<AccountBilling>>(),
  billingProducts: vi.fn<() => Promise<BillingProductInfo[]>>(),
  billingCheckout: vi.fn<(input: CheckoutInput) => Promise<{ url: string }>>(),
  captureEvent: vi.fn<(event: unknown) => void>(),
  identify: vi.fn<(id: string, properties: Record<string, unknown>) => void>(),
}));

vi.mock("@/ipc/api", () => ({
  tauriAPI: {
    account: {
      status: () => mocks.status(),
      sendOtp: (email: string) => mocks.sendOtp(email),
      verifyOtp: (email: string, otp: string, name: string) => mocks.verifyOtp(email, otp, name),
    },
    ui: {
      setPrefs: vi.fn<() => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true }),
    },
  },
}));

// Hand-built oRPC mock that mirrors the `queryOptions` / client shapes the
// component consumes, so React Query drives the mocked billing fns. Building a
// real `createTanstackQueryUtils` here would require importing it inside this
// hoisted mock factory, which a static top-level import cannot reach.
vi.mock("@/lib/orpc", () => ({
  orpc: {
    billing: {
      state: {
        queryOptions: (options?: Record<string, unknown>) => ({
          queryKey: ["billing", "state"],
          queryFn: () => mocks.billingState(),
          ...options,
        }),
      },
      products: {
        queryOptions: (options?: Record<string, unknown>) => ({
          queryKey: ["billing", "products"],
          queryFn: () => mocks.billingProducts(),
          ...options,
        }),
      },
    },
  },
  client: {
    billing: {
      checkout: (input: CheckoutInput) => mocks.billingCheckout(input),
    },
  },
}));

vi.mock("@/lib/telemetry/instance", () => ({
  getTelemetry: () => ({
    captureEvent: mocks.captureEvent,
  }),
}));

vi.mock("posthog-js", () => ({
  default: {
    identify: mocks.identify,
  },
}));

function renderSetup(onConfigured = vi.fn<(config: unknown) => void>()): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <InferenceSetup onConfigured={onConfigured} />
    </QueryClientProvider>,
  );
}

describe("InferenceSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status.mockResolvedValue({
      signedIn: false,
      account: null,
      keyId: null,
      serverUrl: "https://sync.nixmac.app",
      githubReady: false,
      webAccount: null,
    });
    mocks.sendOtp.mockResolvedValue(undefined);
    mocks.verifyOtp.mockResolvedValue({
      signedIn: true,
      account: { email: "ada@example.com" },
      credentialId: "credential-1",
    });
    mocks.billingState.mockResolvedValue(emptyBilling);
    mocks.billingProducts.mockResolvedValue(demoProducts);
    mocks.billingCheckout.mockResolvedValue({ url: "https://polar.sh/demo-checkout" });
  });

  it("signs in to hosted inference with an email one-time code", async () => {
    renderSetup();

    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send sign-in code/i }));

    await waitFor(() => expect(mocks.sendOtp).toHaveBeenCalledWith("ada@example.com"));

    fireEvent.change(screen.getByLabelText(/verification code/i), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify code and continue/i }));

    await waitFor(() =>
      expect(mocks.verifyOtp).toHaveBeenCalledWith("ada@example.com", "123456", "ada"),
    );
    expect(mocks.identify).toHaveBeenCalledWith("ada@example.com", { email: "ada@example.com" });
    expect(screen.getByText(/signed in as/i)).toBeInTheDocument();
  });

  it("shows subscription plan selection with product pricing after sign in", async () => {
    renderSetup();

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send sign-in code/i }));
    await screen.findByLabelText(/verification code/i);
    fireEvent.change(screen.getByLabelText(/verification code/i), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: /verify code and continue/i }));

    expect(await screen.findByText(/choose a plan/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /subscribe to pay as you go/i })).toBeInTheDocument();
    expect(screen.getByText(/device sync across macs/i)).toBeInTheDocument();
    // Prices come from `orpc.billing.products`.
    // Pro shows its subscription price; pay-as-you-go has no subscription fee.
    expect(await screen.findByText("$5/mo")).toBeInTheDocument();
    expect(screen.getByText("Metered")).toBeInTheDocument();
  });

  it("resumes at payment when a web account is already persisted", async () => {
    mocks.status.mockResolvedValue({
      signedIn: false,
      account: null,
      keyId: null,
      serverUrl: "https://sync.nixmac.app",
      githubReady: true,
      webAccount: { id: "acct_1", email: "ada@example.com" },
    });

    renderSetup();

    expect(await screen.findByText(/signed in as/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send sign-in code/i })).not.toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  });

  it("skips checkout when the account already has active PAYG billing", async () => {
    mocks.status.mockResolvedValue({
      signedIn: false,
      account: null,
      keyId: null,
      serverUrl: "https://sync.nixmac.app",
      githubReady: true,
      webAccount: { id: "acct_1", email: "ada@example.com" },
    });
    mocks.billingState.mockResolvedValue({
      ...emptyBilling,
      subscriptions: [
        {
          id: "sub_1",
          slug: "payg-tokens",
          productId: "prod_payg",
          status: "active",
        },
      ],
      hasPaymentMethod: true,
      canUseHostedInference: true,
    });

    renderSetup();

    expect(
      await screen.findByRole("button", { name: /continue with active billing/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/choose a plan/i)).not.toBeInTheDocument();
  });

  it("requires PAYG billing before treating Pro as hosted-ready", async () => {
    mocks.status.mockResolvedValue({
      signedIn: false,
      account: null,
      keyId: null,
      serverUrl: "https://sync.nixmac.app",
      githubReady: true,
      webAccount: { id: "acct_1", email: "ada@example.com" },
    });
    mocks.billingState.mockResolvedValue({
      ...emptyBilling,
      subscriptions: [
        {
          id: "sub_pro",
          slug: "pro",
          productId: "prod_pro",
          status: "active",
        },
      ],
      hasPaymentMethod: true,
      canUseHostedInference: true,
      canUseDeviceSync: true,
    });

    renderSetup();

    expect(await screen.findByText(/choose a plan/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /continue with active billing/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /subscribe to pay as you go/i }),
    ).toBeInTheDocument();
  });

  it("continues as Pro when both PAYG and Pro subscriptions are active", async () => {
    const onConfigured = vi.fn<(config: unknown) => void>();
    mocks.status.mockResolvedValue({
      signedIn: false,
      account: null,
      keyId: null,
      serverUrl: "https://sync.nixmac.app",
      githubReady: true,
      webAccount: { id: "acct_1", email: "ada@example.com" },
    });
    mocks.billingState.mockResolvedValue({
      ...emptyBilling,
      subscriptions: [
        {
          id: "sub_payg",
          slug: "payg-tokens",
          productId: "prod_payg",
          status: "active",
        },
        {
          id: "sub_pro",
          slug: "pro",
          productId: "prod_pro",
          status: "active",
        },
      ],
      hasPaymentMethod: true,
      canUseHostedInference: true,
      canUseDeviceSync: true,
    });

    renderSetup(onConfigured);

    fireEvent.click(await screen.findByRole("button", { name: /continue with active billing/i }));

    await waitFor(() =>
      expect(onConfigured).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "hosted", plan: "pro" }),
      ),
    );
  });
});
