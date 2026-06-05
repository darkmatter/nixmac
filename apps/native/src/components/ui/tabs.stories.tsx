// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

const meta = preview.meta({
  title: "UI/Tabs",
  component: Tabs,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const SettingsSections = meta.story({
  render: () => (
    <Tabs className="w-[420px]" defaultValue="general">
      <TabsList>
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="models">AI Models</TabsTrigger>
        <TabsTrigger value="developer">Developer</TabsTrigger>
      </TabsList>
      <TabsContent className="rounded-md border p-4 text-sm" value="general">
        App preferences and telemetry controls.
      </TabsContent>
      <TabsContent className="rounded-md border p-4 text-sm" value="models">
        Provider, model, and token budgets.
      </TabsContent>
      <TabsContent className="rounded-md border p-4 text-sm" value="developer">
        Advanced diagnostics and pinned release controls.
      </TabsContent>
    </Tabs>
  ),
});
