// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

const meta = preview.meta({
  title: "UI/Select",
  component: Select,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const Provider = meta.story({
  render: () => (
    <Select defaultValue="codex">
      <SelectTrigger className="w-[240px]">
        <SelectValue placeholder="Choose provider" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="openai">OpenAI / OpenRouter</SelectItem>
        <SelectItem value="claude">Claude CLI</SelectItem>
        <SelectItem value="codex">Codex CLI</SelectItem>
        <SelectItem value="opencode">OpenCode CLI</SelectItem>
      </SelectContent>
    </Select>
  ),
});
