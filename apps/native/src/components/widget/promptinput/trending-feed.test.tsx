import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TrendingFeed } from "@/components/widget/promptinput/trending-feed";

vi.mock("@/lib/telemetry/instance", () => ({
  getTelemetry: () => ({ captureEvent: vi.fn<() => void>() }),
}));

describe("<TrendingFeed>", () => {
  it("does not show a browse-all action without a destination", () => {
    render(<TrendingFeed onSelect={vi.fn<(prompt: string) => void>()} />);

    expect(
      screen.getByRole("region", { name: /trending on nixmac/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /browse|see all|view all/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /browse|see all|view all/i }),
    ).not.toBeInTheDocument();
  });
});
