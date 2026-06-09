import snapshotJson from "./track-items.snapshot.json";
import type { CandidateItem, FileTone, FsFile, FsIconName, NixDarwinDocsRef } from "./data";

type TrackItemsSnapshot = {
  version: number;
  sources: {
    nixDarwinDocs: string;
    generatedBy: string;
  };
  sections: TrackItemsSectionSnapshot[];
};

type TrackItemsSectionSnapshot = {
  id: string;
  path: string;
  title: {
    singular: string;
    plural: string;
  };
  description: string;
  iconName: FsIconName;
  tone: FileTone;
  destination: string;
  scanCommand: string;
  scannedAt: string;
  attrFormat: "homebrewCask" | "nixDarwinOption" | "launchdUserAgent";
  source: TrackItemsSourceSnapshot;
  items: TrackItemsItemSnapshot[];
};

type TrackItemsSourceSnapshot = {
  optionPath: string;
  docsPath?: string;
};

type TrackItemsItemSnapshot = {
  name: string;
  detail: string;
  installedAt: string;
  cask?: string;
  value?: string | number | boolean;
  agentName?: string;
  source?: TrackItemsSourceSnapshot;
};

export const TRACK_ITEMS_SNAPSHOT = snapshotJson as TrackItemsSnapshot;

export const TRACK_ITEMS_FILES: FsFile[] = TRACK_ITEMS_SNAPSHOT.sections.map((section) => {
  const source = resolveSource(section.source);
  const items = section.items.map((item) => itemFromSnapshot(section, item));

  return {
    id: section.id,
    path: section.path,
    title: `${items.length} ${items.length === 1 ? section.title.singular : section.title.plural}`,
    description: section.description,
    iconName: section.iconName,
    tone: section.tone,
    status: "candidate",
    destination: section.destination,
    scanCommand: section.scanCommand,
    scannedAt: section.scannedAt,
    items,
    source,
  };
});

function itemFromSnapshot(
  section: TrackItemsSectionSnapshot,
  item: TrackItemsItemSnapshot,
): CandidateItem {
  const source = resolveSource(item.source ?? section.source, section.source);

  return {
    name: item.name,
    detail: item.detail,
    installedAt: item.installedAt,
    attr: attrForItem(section, item, source),
    source,
  };
}

function resolveSource(
  source: TrackItemsSourceSnapshot,
  fallback?: TrackItemsSourceSnapshot,
): NixDarwinDocsRef {
  return {
    optionPath: source.optionPath,
    docsPath: source.docsPath ?? fallback?.docsPath ?? "",
    generatedBy: TRACK_ITEMS_SNAPSHOT.sources.generatedBy,
  };
}

function attrForItem(
  section: TrackItemsSectionSnapshot,
  item: TrackItemsItemSnapshot,
  source: NixDarwinDocsRef,
): string {
  switch (section.attrFormat) {
    case "homebrewCask":
      return `homebrew.casks = [ "${item.cask ?? item.name}" ];`;
    case "nixDarwinOption":
      return `${source.optionPath} = ${formatNixValue(item.value)};`;
    case "launchdUserAgent":
      return `launchd.user.agents.${formatNixAttrKey(item.agentName ?? item.name)} = { ... };`;
  }
}

function formatNixValue(value: TrackItemsItemSnapshot["value"]): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  throw new Error("Track Items snapshot entry is missing a nix-darwin option value");
}

function formatNixAttrKey(key: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_'-]*$/.test(key)) {
    return key;
  }
  return JSON.stringify(key);
}
