// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import {
  homebrewFilesFromDiff,
  launchdItemsFileFromScan,
  systemDefaultsFileFromScan,
} from "./data";
import { SeedDisplay } from "./seed-display";
import { UntrackedCard } from "./untracked-card";

const meta = preview.meta({
  title: "Widget/Filesystem/UntrackedCard",
  component: UntrackedCard,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
});

export default meta;

const [casks, taps, brews] = homebrewFilesFromDiff({
  isInstalled: true,
  casks: ["docker", "obs", "iterm2"],
  brews: ["mas", "ffmpeg"],
  taps: ["homebrew/cask-fonts"],
  source: null,
  lastChecked: Math.floor(Date.now() / 1000) - 14 * 60,
});
const defaults = systemDefaultsFileFromScan({
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
      nixKey: "system.defaults.NSGlobalDomain.KeyRepeat",
      label: "Key repeat speed",
      category: "Keyboard",
      currentValue: "2",
      defaultValue: "6",
    },
  ],
});
const launchd = launchdItemsFileFromScan([
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
  {
    label: "homebrew.mxcl.postgresql@14",
    scope: "LaunchDaemon",
    name: "postgresql@14",
    programArguments: [
      "/opt/homebrew/opt/postgresql@14/bin/postgres",
      "-D",
      "/opt/homebrew/var/postgresql@14",
    ],
    runAtLoad: true,
    keepAlive: true,
    environmentVariables: {},
    standardOutPath: "/opt/homebrew/var/log/postgresql@14.log",
    standardErrorPath: "/opt/homebrew/var/log/postgresql@14.log",
    workingDirectory: "/opt/homebrew",
  },
]);

const trackingHandler =
  (push) =>
  (items): void => {
    push(`Tracked ${items.map((item) => item.name).join(", ")}`);
  };

export const HomebrewCasks = meta.story({
  render: () => (
    <div className="w-[640px]">
      <SeedDisplay title="Tracking action">
        {(push) => <UntrackedCard file={casks} onTrackHomebrewItems={trackingHandler(push)} />}
      </SeedDisplay>
    </div>
  ),
});

export const HomebrewTaps = meta.story({
  render: () => (
    <div className="w-[640px]">
      <SeedDisplay title="Tracking action">
        {(push) => <UntrackedCard file={taps} onTrackHomebrewItems={trackingHandler(push)} />}
      </SeedDisplay>
    </div>
  ),
});

export const HomebrewBrews = meta.story({
  render: () => (
    <div className="w-[640px]">
      <SeedDisplay title="Tracking action">
        {(push) => <UntrackedCard file={brews} onTrackHomebrewItems={trackingHandler(push)} />}
      </SeedDisplay>
    </div>
  ),
});

export const CustomDefaults = meta.story({
  render: () => (
    <div className="w-[640px]">
      <SeedDisplay title="Tracking action">
        {(push) => <UntrackedCard file={defaults} onTrackSystemDefaults={trackingHandler(push)} />}
      </SeedDisplay>
    </div>
  ),
});

export const LoginItems = meta.story({
  render: () => (
    <div className="w-[640px]">
      <SeedDisplay title="Tracking action">
        {(push) => <UntrackedCard file={launchd} onTrackLaunchdItems={trackingHandler(push)} />}
      </SeedDisplay>
    </div>
  ),
});
