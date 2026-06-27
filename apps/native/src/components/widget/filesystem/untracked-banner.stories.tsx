// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { useState } from "react";
import {
  FILES,
  homebrewFilesFromDiff,
  replaceHomebrewPlaceholders,
  replaceSystemDefaultsPlaceholder,
  systemDefaultsFileFromScan,
} from "./data";
import { SeedDisplay } from "./seed-display";
import { UntrackedBanner } from "./untracked-banner";

const meta = preview.meta({
  title: "Widget/Filesystem/UntrackedBanner",
  component: UntrackedBanner,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
});

export default meta;

const storyHomebrew = homebrewFilesFromDiff({
  isInstalled: true,
  casks: ["docker", "obs", "iterm2"],
  brews: ["mas", "ffmpeg"],
  taps: ["homebrew/cask-fonts"],
  source: null,
  lastChecked: Math.floor(Date.now() / 1000) - 14 * 60,
});
const storySystemDefaults = systemDefaultsFileFromScan({
  totalScanned: 212,
  defaults: [
    {
      nixKey: "system.defaults.dock.magnification",
      label: "Enable Dock magnification",
      category: "Dock",
      currentValue: "1",
      defaultValue: "false",
    },
  ],
});
const storyManageFiles = replaceSystemDefaultsPlaceholder(
  replaceHomebrewPlaceholders(FILES.manage, storyHomebrew),
  storySystemDefaults,
);

export const AllSurfaces = meta.story({
  render: () => (
    <div className="w-[640px]">
      <SeedDisplay title="Banner action">
        {(push) => (
          <UntrackedBanner
            candidates={storyManageFiles}
            onView={() => push("(view-only) opening Filesystem → Untracked")}
          />
        )}
      </SeedDisplay>
    </div>
  ),
});

export const SingleSurface = meta.story({
  render: () => (
    <div className="w-[640px]">
      <SeedDisplay title="Banner action">
        {(push) => (
          <UntrackedBanner
            candidates={[storyHomebrew[0]]}
            onView={() => push("(view-only) opening Filesystem → Untracked")}
          />
        )}
      </SeedDisplay>
    </div>
  ),
});

/** Renders nothing — banner short-circuits when there's nothing untracked. */
export const Empty = meta.story({
  render: () => (
    <div className="w-[640px] rounded-md border border-border bg-card/40 p-4 text-[11px] text-muted-foreground">
      Banner returns null when there are zero items. (Nothing rendered above this note.)
      <div className="mt-3">
        <UntrackedBanner candidates={[]} onView={() => {}} />
      </div>
    </div>
  ),
});

/**
 * Demonstrates the banner reacting to its own state — clicking "View"
 * toggles a placeholder (in production it would route to the
 * Filesystem step).
 */
export const ToggleView = meta.story({
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <div className="w-[640px] grid gap-3">
        <UntrackedBanner candidates={storyManageFiles} onView={() => setOpen((v) => !v)} />
        {open && (
          <div className="rounded-md border border-border bg-card/40 p-3 text-[11.5px] text-muted-foreground">
            (Stand-in) Filesystem view → Untracked tab would render here.
          </div>
        )}
      </div>
    );
  },
});
