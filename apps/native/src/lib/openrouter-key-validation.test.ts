import { afterEach, describe, expect, it, vi } from "vitest";

import { verifyOpenrouterApiKey } from "./openrouter-key-validation";

describe("verifyOpenrouterApiKey", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a key only when OpenRouter confirms it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyOpenrouterApiKey("sk-or-valid")).resolves.toEqual({
      ok: true,
      reason: null,
    });
    expect(fetchMock).toHaveBeenCalledWith("https://openrouter.ai/api/v1/auth/key", {
      method: "GET",
      headers: {
        Authorization: "Bearer sk-or-valid",
      },
    });
  });

  it("distinguishes rejected keys from unavailable verification", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 401 }));
    await expect(verifyOpenrouterApiKey("bad-key")).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }));
    await expect(verifyOpenrouterApiKey("sk-or-valid")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")));
    await expect(verifyOpenrouterApiKey("sk-or-valid")).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
