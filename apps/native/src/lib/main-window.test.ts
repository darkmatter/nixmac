import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isPopover: vi.fn<() => Promise<boolean>>(),
  dismissPopover: vi.fn<() => Promise<boolean>>(),
  dismissClose: vi.fn<(input: { token: number }) => Promise<boolean>>(),
  acknowledgeClose: vi.fn<(input: { token: number }) => Promise<boolean>>(),
}));

vi.mock("@/lib/orpc", () => ({
  client: {
    mainWindow: mocks,
  },
}));

describe("main window", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("shares one launch-scoped popover-mode request", async () => {
    mocks.isPopover.mockResolvedValue(true);
    const { isMainWindowPopover } = await import("./main-window");

    await expect(Promise.all([isMainWindowPopover(), isMainWindowPopover()])).resolves.toEqual([
      true,
      true,
    ]);
    expect(mocks.isPopover).toHaveBeenCalledOnce();
  });

  it("retries a rejected probe and retains the first successful launch mode", async () => {
    const error = new Error("IPC not ready");
    mocks.isPopover.mockRejectedValueOnce(error).mockResolvedValue(false);
    const { isMainWindowPopover } = await import("./main-window");

    const initial = isMainWindowPopover();
    expect(isMainWindowPopover()).toBe(initial);
    await expect(initial).rejects.toBe(error);

    await expect(Promise.all([isMainWindowPopover(), isMainWindowPopover()])).resolves.toEqual([
      false,
      false,
    ]);
    mocks.isPopover.mockResolvedValue(true);
    await expect(isMainWindowPopover()).resolves.toBe(false);
    expect(mocks.isPopover).toHaveBeenCalledTimes(2);
  });

  it("dismisses through the main-window procedure", async () => {
    mocks.dismissPopover.mockResolvedValue(true);
    const { dismissMainWindowPopover } = await import("./main-window");

    await expect(dismissMainWindowPopover()).resolves.toBe(true);
    expect(mocks.dismissPopover).toHaveBeenCalledOnce();
  });

  it("acknowledges the exact native close-request token", async () => {
    mocks.acknowledgeClose.mockResolvedValue(true);
    const { acknowledgeMainWindowClose } = await import("./main-window");

    await expect(acknowledgeMainWindowClose(17)).resolves.toBe(true);
    expect(mocks.acknowledgeClose).toHaveBeenCalledWith({ token: 17 });
  });

  it("dismisses only the specified native close request", async () => {
    mocks.dismissClose.mockResolvedValue(false);
    const { dismissMainWindowClose } = await import("./main-window");

    await expect(dismissMainWindowClose(23)).resolves.toBe(false);
    expect(mocks.dismissClose).toHaveBeenCalledWith({ token: 23 });
    expect(mocks.dismissPopover).not.toHaveBeenCalled();
    expect(mocks.acknowledgeClose).not.toHaveBeenCalled();
  });
});
