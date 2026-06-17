// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import {
  FILES,
  homebrewFilesFromDiff,
  launchdItemsFileFromScan,
  replaceHomebrewPlaceholders,
  replaceLaunchdPlaceholder,
  replaceSystemDefaultsPlaceholder,
  systemDefaultsFileFromScan,
} from "./data";
import { FileList } from "./file-list";
import { SeedDisplay } from "./seed-display";
import { seedForFile } from "./seed-prompt";

const meta = preview.meta({
  title: "Widget/Filesystem/FileList",
  component: FileList,
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
const storyLaunchd = launchdItemsFileFromScan([
  {
    label: "homebrew.mxcl.redis",
    scope: "LaunchdUserAgent",
    name: "redis",
    programArguments: ["/opt/homebrew/opt/redis/bin/redis-server", "/opt/homebrew/etc/redis.conf"],
    runAtLoad: true,
    keepAlive: true,
    environmentVariables: {},
    standardOutPath: "/opt/homebrew/var/log/redis.log",
    standardErrorPath: "/opt/homebrew/var/log/redis.log",
    workingDirectory: "/opt/homebrew/var",
  },
]);
const storyManageFiles = replaceLaunchdPlaceholder(
  replaceSystemDefaultsPlaceholder(
    replaceHomebrewPlaceholders(FILES.manage, storyHomebrew),
    storySystemDefaults,
  ),
  storyLaunchd,
);
const trackingHandler =
  (push) =>
  (items): void => {
    push(`Tracked ${items.map((item) => item.name).join(", ")}`);
  };

export const SystemSection = meta.story({
  render: () => (
    <SeedDisplay>
      {(push) => (
        <div className="h-[520px] w-[640px]">
          <FileList
            files={FILES.darwin}
            onEditWithPrompt={(f) => push(seedForFile(f))}
          />
        </div>
      )}
    </SeedDisplay>
  ),
});

export const PersonalSection = meta.story({
  render: () => (
    <SeedDisplay>
      {(push) => (
        <div className="h-[520px] w-[640px]">
          <FileList
            files={FILES.home}
            onEditWithPrompt={(f) => push(seedForFile(f))}
          />
        </div>
      )}
    </SeedDisplay>
  ),
});

export const UntrackedSection = meta.story({
  render: () => (
    <SeedDisplay>
      {(push) => (
        <div className="h-[520px] w-[640px]">
          <FileList
            files={storyManageFiles}
            onEditWithPrompt={(f) => push(seedForFile(f))}
            onTrackHomebrewItems={trackingHandler(push)}
            onTrackSystemDefaults={trackingHandler(push)}
            onTrackLaunchdItems={trackingHandler(push)}
          />
        </div>
      )}
    </SeedDisplay>
  ),
});

export const SetupSection = meta.story({
  render: () => (
    <SeedDisplay>
      {(push) => (
        <div className="h-[520px] w-[640px]">
          <FileList
            files={FILES.entry}
            onEditWithPrompt={(f) => push(seedForFile(f))}
          />
        </div>
      )}
    </SeedDisplay>
  ),
});
