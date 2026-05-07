// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";
import { Badge } from "./badge";

const meta = preview.meta({
  title: "UI/Badge",
  component: Badge,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const Variants = meta.story({
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>
        <CheckCircle2 />
        Ready
      </Badge>
      <Badge variant="secondary">
        <Sparkles />
        Preview
      </Badge>
      <Badge variant="outline">Queued</Badge>
      <Badge variant="destructive">
        <AlertTriangle />
        Failed
      </Badge>
    </div>
  ),
});
