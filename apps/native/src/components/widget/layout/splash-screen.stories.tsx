// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { SPLASH_STAGES, SplashScreen } from "./splash-screen";

const meta = preview.meta({
  title: "App/SplashScreen",
  component: SplashScreen,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  // Stories skip the 400ms hold — there is nothing to wait for here.
  args: { stage: "permissions", appearDelayMs: 0 },
  argTypes: {
    stage: { control: "inline-radio", options: [...SPLASH_STAGES] },
  },
});

export default meta;

/** What the window shows while the launch probes run. */
export const Default = meta.story({});

/** Every stage the progress bar walks through, first to last. */
export const Stages = meta.story({
  render: () => (
    <div className="grid h-full grid-cols-2 gap-4">
      {SPLASH_STAGES.map((stage) => (
        <div
          key={stage}
          className="relative h-72 overflow-hidden rounded-lg border border-border"
        >
          <SplashScreen stage={stage} appearDelayMs={0} />
        </div>
      ))}
    </div>
  ),
});
