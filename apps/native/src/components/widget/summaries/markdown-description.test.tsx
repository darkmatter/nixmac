import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownDescription } from "./markdown-description";
import { commitMessageBody, hasMarkdownSyntax, shouldExpandDescription } from "./markdown-utils";

vi.mock("@/components/widget/summaries/markdown-content", () => ({
  MarkdownContent: ({ children }: { children: string }) => (
    <div data-testid="markdown-content">{children}</div>
  ),
}));

describe("markdown-utils", () => {
  it("extracts body after subject line", () => {
    const full = "feat: add widget\n\n- item one\n- item two";
    expect(commitMessageBody(full)).toBe("- item one\n- item two");
  });

  it("returns empty body for single-line messages", () => {
    expect(commitMessageBody("feat: only subject")).toBe("");
  });

  it("detects markdown syntax", () => {
    expect(hasMarkdownSyntax("plain text")).toBe(false);
    expect(hasMarkdownSyntax("- bullet")).toBe(true);
    expect(hasMarkdownSyntax("**bold**")).toBe(true);
  });

  it("expands when text exceeds line limit or contains markdown", () => {
    expect(shouldExpandDescription("one line", 2)).toBe(false);
    expect(shouldExpandDescription("line one\nline two\nline three", 2)).toBe(true);
    expect(shouldExpandDescription("- one bullet", 2)).toBe(true);
  });
});

describe("MarkdownDescription", () => {
  it("renders nothing for empty text", () => {
    const { container } = render(<MarkdownDescription text="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens modal with formatted content when expandable", () => {
    const text = "Intro\n\n- first\n- second\n- third";

    render(<MarkdownDescription modalTitle="feat: test" text={text} />);

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("feat: test")).toBeInTheDocument();
    expect(screen.getByTestId("markdown-content")).toContainHTML("Intro");
    expect(screen.getByTestId("markdown-content")).toContainHTML("first");
  });

  it("does not open modal for short plain text", () => {
    render(<MarkdownDescription text="Short plain body" />);

    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
