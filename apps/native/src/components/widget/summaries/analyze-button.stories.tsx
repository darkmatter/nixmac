// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { Dna, Loader2 } from "lucide-react";
import { AnalyzeButton } from "./analyze-button";

const meta = preview.meta({
  title: "Widget/Summaries/AnalyzeButton",
  component: AnalyzeButton,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const Idle = meta.story({
  render: () => (
    <AnalyzeButton onClick={() => {}}>
      <Dna className="h-[10px] w-[10px]" />
      Analyze
    </AnalyzeButton>
  ),
});

export const Loading = meta.story({
  render: () => (
    <AnalyzeButton disabled>
      <Loader2 className="h-[10px] w-[10px] animate-spin" />
      Analyzing…
    </AnalyzeButton>
  ),
});

export const WithCount = meta.story({
  render: () => (
    <AnalyzeButton onClick={() => {}}>
      <Dna className="h-[10px] w-[10px]" />
      Analyze recent (3)
    </AnalyzeButton>
  ),
});

export const Update = meta.story({
  render: () => (
    <AnalyzeButton onClick={() => {}}>
      <Dna className="h-[10px] w-[10px]" />
      Update
    </AnalyzeButton>
  ),
});
