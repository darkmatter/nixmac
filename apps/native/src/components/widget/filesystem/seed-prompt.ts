import type { FsFile } from "./data";

/**
 * Build a prompt seed for "Edit this file with a prompt." The seed is
 * a task-shaped sentence that primes the user to describe what they
 * want; the AI handles the actual edit. The user can erase or edit
 * the seed before sending.
 */
export function seedForFile(file: FsFile): string {
  if (file.readonly) {
    return `Regenerate ${file.path}.`;
  }
  const hint = file.promptHint ? ` (${file.promptHint})` : "";
  return `Change ${file.path}${hint}: `;
}
