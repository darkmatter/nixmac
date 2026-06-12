// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import {
  FILES,
  homebrewFilesFromDiff,
  replaceHomebrewPlaceholders,
  replaceSystemDefaultsPlaceholder,
  systemDefaultsFileFromScan,
  type FsFile,
} from "./data";
import {
  seedForFile,
  seedForUntrackedBanner,
  seedForUntrackedItem,
  seedForUntrackedSection,
} from "./seed-prompt";

/**
 * Reference story — these are pure functions, but having a visible
 * "show me every seed for every file" page lets reviewers eyeball the
 * prompt bias copy without wiring up the full flow.
 */
function SeedTable() {
  const all = Object.values({ ...FILES, manage: storyManageFiles }).flat();
  return (
    <div className="grid gap-2">
      <div className="font-semibold text-[12px]">seedForFile (per managed/candidate file)</div>
      <table className="w-full border-collapse rounded-md border border-border text-[11px]">
        <thead>
          <tr className="border-border border-b bg-card/40">
            <th className="px-3 py-2 text-left font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
              File
            </th>
            <th className="px-3 py-2 text-left font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
              Seed
            </th>
          </tr>
        </thead>
        <tbody>
          {all.map((f: FsFile) => (
            <tr key={f.id} className="border-border/40 border-b last:border-b-0">
              <td className="px-3 py-2 align-top font-mono text-[10.5px] text-muted-foreground">
                {f.path}
              </td>
              <td className="px-3 py-2 align-top">
                <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[10.5px] text-teal-200 leading-[1.5]">
                  {seedForFile(f)}
                </pre>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const meta = preview.meta({
  title: "Widget/Filesystem/SeedPrompt",
  component: SeedTable,
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
    {
      nixKey: "system.defaults.finder.ShowPathbar",
      label: "Show path bar",
      category: "Finder",
      currentValue: "1",
      defaultValue: "false",
    },
  ],
});
const storyManageFiles = replaceSystemDefaultsPlaceholder(
  replaceHomebrewPlaceholders(FILES.manage, storyHomebrew),
  storySystemDefaults,
);

export const PerFileSeeds = meta.story({
  render: () => <SeedTable />,
});

export const UntrackedSectionSeed = meta.story({
  render: () => {
    const brew = storyHomebrew[0];
    return (
      <pre className="m-0 max-w-[700px] whitespace-pre-wrap rounded-md border border-border bg-card/40 p-3 font-mono text-[11px] text-teal-200 leading-[1.5]">
        {seedForUntrackedSection(brew)}
      </pre>
    );
  },
});

export const SingleItemSeed = meta.story({
  render: () => {
    const brew = storyHomebrew[0];
    const item = brew.items![0];
    return (
      <pre className="m-0 max-w-[700px] whitespace-pre-wrap rounded-md border border-border bg-card/40 p-3 font-mono text-[11px] text-teal-200 leading-[1.5]">
        {seedForUntrackedItem(brew, item)}
      </pre>
    );
  },
});

export const BannerSeed = meta.story({
  render: () => (
    <pre className="m-0 max-w-[700px] whitespace-pre-wrap rounded-md border border-border bg-card/40 p-3 font-mono text-[11px] text-teal-200 leading-[1.5]">
      {seedForUntrackedBanner(storyManageFiles)}
    </pre>
  ),
});
