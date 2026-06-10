import type { CandidateItem, FsFile } from "./data";

/**
 * Build a prompt seed for "Edit this file with a prompt." The seed is
 * a task-shaped sentence that primes the user to describe what they
 * want; the AI handles the actual edit. The user can erase or edit
 * the seed before sending.
 */
export function seedForFile(file: FsFile): string {
  if (file.status === "candidate") {
    return seedForUntrackedSection(file);
  }
  if (file.readonly) {
    return `Regenerate ${file.path}.`;
  }
  const hint = file.promptHint ? ` (${file.promptHint})` : "";
  return `Change ${file.path}${hint}: `;
}

/**
 * Build a prompt seed for "Track all items in this Untracked section."
 * Inlines the item names so the AI has the full list without needing
 * a separate scan call.
 */
export function seedForUntrackedSection(file: FsFile): string {
  if (file.status !== "candidate" || !file.items?.length) {
    return `Track ${file.title.toLowerCase()}.`;
  }
  const dest = file.destination ?? "the right module";
  const list = file.items.map((it) => `- ${it.name} (${it.detail})`).join("\n");
  return `Track these items by adding them to ${dest}:\n${list}\n`;
}

/**
 * Build a prompt seed for tracking a single untracked item.
 */
export function seedForUntrackedItem(file: FsFile, item: CandidateItem): string {
  const dest = file.destination ?? "the right module";
  return `Track "${item.name}" by adding it to ${dest}. Detail: ${item.detail}.`;
}

/**
 * Build a prompt seed for the BeginStep "Untracked" banner by stacking
 * the same itemized prompt used for each candidate section.
 */
export function seedForUntrackedBanner(files: FsFile[]): string {
  const candidates = files.filter((f) => f.status === "candidate" && f.items?.length);
  if (!candidates.length) return "Track everything that isn't in my config yet.";
  return candidates.map(seedForUntrackedSection).join("\n");
}
