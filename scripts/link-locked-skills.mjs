import { readFileSync } from "node:fs";
import { lstat, mkdir, readlink, symlink, unlink } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const lock = JSON.parse(readFileSync(join(root, "skills-lock.json"), "utf8"));
const names = Object.keys(lock.skills ?? {});

if (names.length === 0) {
  console.warn("skills-lock.json has no skills");
  process.exit(0);
}

const claudeSkillsDir = join(root, ".claude", "skills");
await mkdir(claudeSkillsDir, { recursive: true });

for (const name of names) {
  const canonical = join(root, ".agents", "skills", name);
  try {
    await lstat(join(canonical, "SKILL.md"));
  } catch {
    console.error(`missing restored skill: ${canonical}`);
    process.exit(1);
  }

  const linkPath = join(claudeSkillsDir, name);
  const relativeTarget = relative(claudeSkillsDir, canonical);

  let kind = "missing";
  try {
    const st = await lstat(linkPath);
    kind = st.isSymbolicLink() ? "symlink" : st.isDirectory() ? "dir" : "file";
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  if (kind === "dir" || kind === "file") {
    console.error(`${linkPath} exists and is not a symlink`);
    process.exit(1);
  }

  if (kind === "symlink") {
    if ((await readlink(linkPath)) === relativeTarget) continue;
    await unlink(linkPath);
  }

  await symlink(relativeTarget, linkPath);
}
