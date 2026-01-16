import { vi } from "vitest";

// Mock store helpers first (used by determineHostAttr)
vi.mock("../electron/store", () => ({
  getHostAttrFromStore: vi.fn(() => {}),
  readHostAttrFromFile: vi.fn(() => "host-from-file"),
}));

// Mock execa for nix commands
vi.mock("execa", () => ({
  execa: vi.fn((cmd: string, args: string[]) => {
    const key = `${cmd} ${args.join(" ")}`;
    if (
      key.includes(
        "nix eval --json .#darwinConfigurations --apply builtins.attrNames"
      )
    ) {
      return Promise.resolve({ stdout: JSON.stringify(["mbp", "imac"]) });
    }
    if (
      key.includes(
        "nix eval --json .#darwinConfigurations.mbp.config.environment.systemPackages"
      )
    ) {
      return Promise.resolve({
        stdout: JSON.stringify([{ name: "vim" }, { name: "git" }]),
      });
    }
    return Promise.resolve({ stdout: '""' });
  }),
}));
