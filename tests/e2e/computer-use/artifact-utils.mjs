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

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 8 < buffer.length) {
    while (offset < buffer.length && buffer[offset] !== 0xff) offset += 1;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda || offset + 2 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker) && segmentLength >= 7) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }
    offset += segmentLength;
  }
  return null;
}

export function imageMetadata(value, declaredMimeType = "") {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || "");
  if (buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return {
      format: "png",
      extension: ".png",
      mimeType: "image/png",
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    const dimensions = jpegDimensions(buffer);
    return {
      format: "jpeg",
      extension: ".jpg",
      mimeType: "image/jpeg",
      ...(dimensions || {}),
    };
  }
  const normalizedMimeType = String(declaredMimeType || "").toLowerCase();
  if (normalizedMimeType === "image/jpeg" || normalizedMimeType === "image/jpg") {
    return { format: "jpeg", extension: ".jpg", mimeType: "image/jpeg" };
  }
  if (normalizedMimeType === "image/png") {
    return { format: "png", extension: ".png", mimeType: "image/png" };
  }
  return {
    format: "unknown",
    extension: ".img",
    mimeType: normalizedMimeType || "application/octet-stream",
  };
}

export function imageDimensions(filePath) {
  try {
    const buffer = readFileSync(filePath);
    const metadata = imageMetadata(buffer);
    if (!metadata.width || !metadata.height) return null;
    return { width: metadata.width, height: metadata.height };
  } catch {
    return null;
  }
}

// Compatibility alias for older report fixtures and callers. The parser is
// intentionally format-aware because Computer Use can return JPEG screenshots.
export const pngDimensions = imageDimensions;
