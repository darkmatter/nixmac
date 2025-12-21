import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commitAll, initIfNeeded, isRepo, status } from "../electron/git";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "darwinian-git-"));
const repoDir = path.join(tmpRoot, "repo");

describe("git helpers (integration with real git)", () => {
  beforeAll(() => {
    fs.mkdirSync(repoDir, { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // Cleanup best effort
    }
  });

  it("initIfNeeded initializes repository and creates .gitignore", async () => {
    await initIfNeeded(repoDir);
    expect(await isRepo(repoDir)).toBe(true);
    expect(fs.existsSync(path.join(repoDir, ".gitignore"))).toBe(true);
  });

  it("status reflects changes", async () => {
    fs.writeFileSync(path.join(repoDir, "file.txt"), "hello");
    const s = await status(repoDir);
    expect(s.hasChanges).toBe(true);
  });

  it("commitAll stages and commits", async () => {
    fs.writeFileSync(path.join(repoDir, "file2.txt"), "world");
    const res = await commitAll(repoDir, "test commit");
    expect(res.summary.changes).toBeGreaterThan(0);
  });
});
