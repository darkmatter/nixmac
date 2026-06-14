// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { FILES, homebrewFilesFromDiff } from "./data";
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
const defaults = FILES.manage.find((f) => f.id === "custom-defaults")!;
const login = FILES.manage.find((f) => f.id === "login-items")!;

export const HomebrewCasks = meta.story({
  render: () => (
    <div className="w-[640px]">
      <SeedDisplay title="Tracking seed">
        {(push) => <UntrackedCard file={casks} onTrack={push} />}
      </SeedDisplay>
    </div>
  ),
});

export const HomebrewTaps = meta.story({
  render: () => (
    <div className="w-[640px]">
      <SeedDisplay title="Tracking seed">
        {(push) => <UntrackedCard file={taps} onTrack={push} />}
      </SeedDisplay>
    </div>
  ),
});

export const HomebrewBrews = meta.story({
  render: () => (
    <div className="w-[640px]">
      <SeedDisplay title="Tracking seed">
        {(push) => <UntrackedCard file={brews} onTrack={push} />}
      </SeedDisplay>
    </div>
  ),
});

export const CustomDefaults = meta.story({
  render: () => (
    <div className="w-[640px]">
      <SeedDisplay title="Tracking seed">
        {(push) => <UntrackedCard file={defaults} onTrack={push} />}
      </SeedDisplay>
    </div>
  ),
});

export const LoginItems = meta.story({
  render: () => (
    <div className="w-[640px]">
      <SeedDisplay title="Tracking seed">
        {(push) => <UntrackedCard file={login} onTrack={push} />}
      </SeedDisplay>
    </div>
  ),
});
