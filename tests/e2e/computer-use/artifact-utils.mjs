import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export function artifactForLabel(items, label) {
  return items.find((item) => item.label === label) || null;
}

export function artifactFileIssue(state, relativePath) {
  if (!relativePath) return "artifact path is empty";
  try {
    const stats = statSync(path.join(state.runDir, relativePath));
    if (!stats.isFile()) return "it is not a file";
    if (stats.size === 0) return "the file is empty";
    return "";
  } catch {
    return "the file is missing";
  }
}

export function pngDimensions(filePath) {
  try {
    const buffer = readFileSync(filePath);
    if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  } catch {
    return null;
  }
}
