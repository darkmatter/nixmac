import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks
vi.mock("execa", () => ({
  execa: vi.fn((cmd: string, args: string[]) => {
    const key = `${cmd} ${args.join(" ")}`;
    if (key.startsWith("codex e ")) {
      return Promise.resolve({ stdout: "" });
    }
    if (cmd === "bash") {
      return Promise.resolve({ stdout: "nonempty" });
    }
    if (cmd === "git" && args[0] === "apply") {
      return Promise.resolve({ stdout: "" });
    }
    return Promise.resolve({ stdout: "" });
  }),
}));

vi.mock("sudo-prompt", () => {
  const exec = vi.fn((_cmd: string, _opts: any, cb: any) => cb(null, "ok", ""));
  return { default: { exec }, exec };
});

vi.mock("../electron/nix", () => ({
  determineHostAttr: vi.fn(() => "test-host"),
  darwinRebuildSwitch: vi.fn(),
}));

import { apply, evolve } from "../electron/cli/darwin";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "darwinian-cli-"));

describe("darwin CLI wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try {
      fs.mkdirSync(tmp, { recursive: true });
    } catch {
      // Directory may already exist in repeated runs
    }
  });

  it("evolve runs codex and applies non-empty patch", async () => {
    const { execa } = (await import("execa")) as any;
    await evolve(tmp, "install vim");
    // execa called for codex, bash size check, and git apply
    expect(execa).toHaveBeenCalled();
    const calls = (execa as any).mock.calls.map(([cmd]: any[]) => cmd);
    expect(calls).toContain("codex");
    expect(calls).toContain("bash");
    expect(calls).toContain("git");
  });

  it("apply elevates via sudo and uses host from determineHostAttr", async () => {
    const sudoPrompt = (await import("sudo-prompt")) as any;
    const res = await apply(tmp);
    expect(sudoPrompt.default.exec).toHaveBeenCalled();
    expect(res).toHaveProperty("stdout", "ok");
  });
});
