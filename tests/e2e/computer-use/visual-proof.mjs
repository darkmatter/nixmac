import path from "node:path";
import { artifactFileIssue, artifactForLabel, imageDimensions } from "./artifact-utils.mjs";
import { mediaToolEnvironment } from "./continuous-recording.mjs";
import { tryRun } from "./process-utils.mjs";

const visualProbeDefaults = {
  minWidth: 500,
  minHeight: 500,
  minYMax: 50,
  minYRange: 10,
  minCropYMax: 38,
  minCropYRange: 4,
};

export function parseSignalStats(output) {
  const stats = {};
  for (const line of String(output || "").split("\n")) {
    const match = line.match(/lavfi\.signalstats\.([A-Z]+)=([0-9.]+)/);
    if (match) stats[match[1]] = Number(match[2]);
  }
  return stats;
}

export function pngSignalStats(filePath, crop = null) {
  const filters = [];
  if (crop) filters.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`);
  filters.push("signalstats", "metadata=print:file=-");
  const result = tryRun(
    "ffmpeg",
    ["-hide_banner", "-i", filePath, "-vf", filters.join(","), "-frames:v", "1", "-f", "null", "-"],
    { env: mediaToolEnvironment() },
  );
  if (!result.ok) {
    return {
      ok: false,
      error: result.stderr || result.error,
      stats: {},
    };
  }
  return {
    ok: true,
    stats: parseSignalStats(`${result.stdout}\n${result.stderr}`),
  };
}

export function imageArtifactIssue(state, relativePath) {
  const baseIssue = artifactFileIssue(state, relativePath);
  if (baseIssue) return baseIssue;
  const fullPath = path.join(state.runDir, relativePath);
  const result = pngSignalStats(fullPath);
  if (!result.ok) return `ffmpeg could not inspect the image (${result.error})`;
  const yMax = result.stats.YMAX;
  const yMin = result.stats.YMIN;
  if (Number.isFinite(yMax) && yMax < 40)
    return "the screenshot appears blank or visually occluded";
  if (Number.isFinite(yMax) && Number.isFinite(yMin) && yMax - yMin < 4)
    return "the screenshot has too little visual contrast";
  return "";
}

export function probeCropForImage(imageSize, probe) {
  if (!imageSize?.width || !imageSize?.height) return null;
  const x = Math.max(0, Math.floor((imageSize.width * probe.x) / 100));
  const y = Math.max(0, Math.floor((imageSize.height * probe.y) / 100));
  const w = Math.max(1, Math.floor((imageSize.width * probe.w) / 100));
  const h = Math.max(1, Math.floor((imageSize.height * probe.h) / 100));
  if (x + w > imageSize.width || y + h > imageSize.height) return null;
  return { x, y, w, h };
}

function visualCheckPass(name, detail) {
  return { name, status: "pass", detail };
}

function visualCheckFail(name, detail) {
  return { name, status: "fail", detail };
}

export function evaluateScreenshotVisualContract(state, screenshotRequirement) {
  const labels =
    Array.isArray(screenshotRequirement.labels) && screenshotRequirement.labels.length > 0
      ? screenshotRequirement.labels
      : [screenshotRequirement.label];
  const shot = labels.map((label) => artifactForLabel(state.screenshots, label)).find(Boolean);
  const checks = [];
  if (!shot) {
    const missingDetail =
      labels.length > 1
        ? `Required screenshot artifact is missing from state.screenshots: ${labels.join(", ")}.`
        : "Required screenshot artifact is missing from state.screenshots.";
    return {
      label: screenshotRequirement.label || labels.join(" or "),
      status: "fail",
      checks: [visualCheckFail("screenshot artifact", missingDetail)],
    };
  }

  const fullPath = path.join(state.runDir, shot.path);
  const baseIssue = artifactFileIssue(state, shot.path);
  if (baseIssue) {
    return {
      label: shot.label,
      path: shot.path,
      status: "fail",
      checks: [visualCheckFail("screenshot artifact", baseIssue)],
    };
  }

  const imageSize = shot.imageSize || imageDimensions(fullPath);
  if (!imageSize) {
    checks.push(visualCheckFail("image dimensions", "Could not read image dimensions."));
  } else if (
    imageSize.width < visualProbeDefaults.minWidth ||
    imageSize.height < visualProbeDefaults.minHeight
  ) {
    checks.push(
      visualCheckFail(
        "image dimensions",
        `${imageSize.width}x${imageSize.height} is below ${visualProbeDefaults.minWidth}x${visualProbeDefaults.minHeight}.`,
      ),
    );
  } else {
    checks.push(visualCheckPass("image dimensions", `${imageSize.width}x${imageSize.height}.`));
  }

  const fullStats = pngSignalStats(fullPath);
  if (!fullStats.ok) {
    checks.push(
      visualCheckFail(
        "full-frame decode",
        `ffmpeg could not inspect the image (${fullStats.error}).`,
      ),
    );
  } else {
    const yMin = fullStats.stats.YMIN;
    const yMax = fullStats.stats.YMAX;
    const yRange = Number.isFinite(yMin) && Number.isFinite(yMax) ? yMax - yMin : NaN;
    if (!Number.isFinite(yMax) || yMax < visualProbeDefaults.minYMax) {
      checks.push(
        visualCheckFail(
          "full-frame brightness",
          `YMAX ${yMax ?? "unknown"} is below ${visualProbeDefaults.minYMax}.`,
        ),
      );
    } else if (!Number.isFinite(yRange) || yRange < visualProbeDefaults.minYRange) {
      checks.push(
        visualCheckFail(
          "full-frame contrast",
          `Y range ${Number.isFinite(yRange) ? yRange : "unknown"} is below ${visualProbeDefaults.minYRange}.`,
        ),
      );
    } else {
      checks.push(visualCheckPass("full-frame signal", `Y range ${yMin}-${yMax}.`));
    }
  }

  for (const probe of screenshotRequirement.probes || []) {
    if (
      typeof probe.x !== "number" ||
      typeof probe.y !== "number" ||
      typeof probe.w !== "number" ||
      typeof probe.h !== "number"
    ) {
      checks.push(
        visualCheckFail(probe.label || "visual probe", "Probe coordinates are incomplete."),
      );
      continue;
    }
    if (
      probe.x < 0 ||
      probe.y < 0 ||
      probe.w <= 0 ||
      probe.h <= 0 ||
      probe.x + probe.w > 100 ||
      probe.y + probe.h > 100
    ) {
      checks.push(
        visualCheckFail(
          probe.label || "visual probe",
          "Probe coordinates are outside image bounds.",
        ),
      );
      continue;
    }
    const crop = probeCropForImage(imageSize, probe);
    if (!crop) {
      checks.push(
        visualCheckFail(
          probe.label || "visual probe",
          "Probe could not be mapped into image pixels.",
        ),
      );
      continue;
    }
    const cropStats = pngSignalStats(fullPath, crop);
    if (!cropStats.ok) {
      checks.push(
        visualCheckFail(probe.label, `ffmpeg could not inspect crop (${cropStats.error}).`),
      );
      continue;
    }
    const yMin = cropStats.stats.YMIN;
    const yMax = cropStats.stats.YMAX;
    const yRange = Number.isFinite(yMin) && Number.isFinite(yMax) ? yMax - yMin : NaN;
    const minYMax = probe.minYMax ?? visualProbeDefaults.minCropYMax;
    const minYRange = probe.minYRange ?? visualProbeDefaults.minCropYRange;
    if (!Number.isFinite(yMax) || yMax < minYMax) {
      checks.push(
        visualCheckFail(probe.label, `crop YMAX ${yMax ?? "unknown"} is below ${minYMax}.`),
      );
    } else if (!Number.isFinite(yRange) || yRange < minYRange) {
      checks.push(
        visualCheckFail(
          probe.label,
          `crop Y range ${Number.isFinite(yRange) ? yRange : "unknown"} is below ${minYRange}.`,
        ),
      );
    } else {
      checks.push(
        visualCheckPass(
          probe.label,
          `crop ${crop.w}x${crop.h}+${crop.x}+${crop.y}, Y range ${yMin}-${yMax}.`,
        ),
      );
    }
  }

  return {
    label: shot.label,
    path: shot.path,
    status: checks.some((check) => check.status === "fail") ? "fail" : "pass",
    checks,
  };
}
