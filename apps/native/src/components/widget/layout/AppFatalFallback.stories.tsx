// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { AppFatalFallback } from "./AppFatalFallback";

const meta = preview.meta({
  title: "App/AppFatalFallback",
  component: AppFatalFallback,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
});

export default meta;

export const Default = meta.story({
  render: () => <AppFatalFallback error={new Error("Unable to read user preferences")} />,
});

export const LongMessage = meta.story({
  render: () => (
    <AppFatalFallback
      error={
        new Error(
          "TypeError: Cannot read properties of undefined (reading 'sendDiagnostics'). The widget store may have been corrupted by an earlier IPC failure; reloading typically clears this state, but if the underlying preference file is malformed the same error will reappear after reload.",
        )
      }
    />
  ),
});

export const WithStack = meta.story({
  render: () => {
    const error = new Error("Render crashed in <EvolveOverlayPanel />");
    error.stack = `Error: Render crashed in <EvolveOverlayPanel />
    at EvolveOverlayPanel (apps/native/src/components/widget/overlays/evolve-overlay-panel.tsx:42:11)
    at DarwinWidget (apps/native/src/components/widget/widget.tsx:120:5)
    at App (apps/native/src/App.tsx:14:3)`;
    return <AppFatalFallback error={error} />;
  },
});

export const NoErrorObject = meta.story({
  render: () => <AppFatalFallback />,
});
