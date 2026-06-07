/** Body of a conventional commit message (everything after the subject line). */
export function commitMessageBody(full: string): string {
  const trimmed = full.trim();
  const newlineIndex = trimmed.indexOf("\n");
  if (newlineIndex === -1) {
    return "";
  }
  return trimmed.slice(newlineIndex + 1).trim();
}

export function lineCount(text: string): number {
  if (!text) {
    return 0;
  }
  return text.split(/\r?\n/).length;
}

export function exceedsLineLimit(text: string, maxLines: number): boolean {
  return lineCount(text) > maxLines;
}

const MARKDOWN_PATTERN =
  /(\*\*|__|\*|_|`|\[[^\]]+\]\([^)]+\)|^#{1,6}\s|^(?:[-*]|\d+\.)\s)/m;

export function hasMarkdownSyntax(text: string): boolean {
  return MARKDOWN_PATTERN.test(text);
}

export function shouldExpandDescription(
  text: string,
  maxLines: number,
): boolean {
  return exceedsLineLimit(text, maxLines) || hasMarkdownSyntax(text);
}
