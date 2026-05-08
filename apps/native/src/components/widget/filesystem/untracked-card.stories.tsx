// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { FILES } from "./data";
import { SeedDisplay } from "./seed-display";
import { UntrackedCard } from "./untracked-card";

const meta = preview.meta({
  title: "Widget/Filesystem/UntrackedCard",
  component: UntrackedCard,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
});

export default meta;

const brew = FILES.manage.find((f) => f.id === "untracked-brew")!;
const defaults = FILES.manage.find((f) => f.id === "custom-defaults")!;
const login = FILES.manage.find((f) => f.id === "login-items")!;

export const HomebrewCasks = meta.story({
  render: () => (
    <div className="w-[640px]">
      <SeedDisplay title="Tracking seed">
        {(push) => <UntrackedCard file={brew} onTrack={push} />}
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
