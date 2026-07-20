import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { Combobox } from "@/components/ui/combobox";

const ITEMS = ["item-a", "item-b", "item-c"];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface HarnessProps {
  initial?: string;
  items?: string[];
  emptyValueLabel?: string;
  allowCustomValue?: boolean;
  isLoading?: boolean;
  onChangeSpy?: (value: string) => void;
}

function Harness({
  initial = "",
  items = ITEMS,
  emptyValueLabel,
  allowCustomValue = false,
  isLoading = false,
  onChangeSpy,
}: HarnessProps) {
  const [value, setValue] = useState(initial);
  return (
    <Combobox
      items={items}
      value={value}
      onChange={(v) => {
        onChangeSpy?.(v);
        setValue(v);
      }}
      emptyValueLabel={emptyValueLabel}
      allowCustomValue={allowCustomValue}
      isLoading={isLoading}
      placeholder="Pick one"
    />
  );
}

function input() {
  return screen.getByRole("combobox") as HTMLInputElement;
}

function openList() {
  fireEvent.mouseDown(input());
  fireEvent.focus(input());
  return screen.getAllByRole("option");
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(() => {
  // jsdom has no layout: cmdk scrolls the highlighted item into view and the
  // cmdk list observes its own size.
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

// ---------------------------------------------------------------------------
// Interaction matrix
// ---------------------------------------------------------------------------

describe("Combobox", () => {
  it("opens with the full unfiltered list and the current selection highlighted", () => {
    render(<Harness initial="item-b" emptyValueLabel="Default" />);

    const options = openList();

    // Full list (empty-value row + all items), no filtering by the current value
    expect(options.map((o) => o.textContent)).toEqual(["Default", ...ITEMS]);
    // The selected item is highlighted, not the first row
    expect(screen.getByRole("option", { name: "item-b" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("regression: Enter right after opening re-commits the current selection, not the first row", () => {
    const onChangeSpy = vi.fn();
    render(<Harness initial="item-b" emptyValueLabel="Default" onChangeSpy={onChangeSpy} />);

    openList();
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onChangeSpy).toHaveBeenCalledWith("item-b");
    expect(onChangeSpy).not.toHaveBeenCalledWith("");
    expect(input()).toHaveValue("item-b");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("typing filters the list without committing; clicking an item commits it", () => {
    const onChangeSpy = vi.fn();
    render(<Harness initial="item-b" onChangeSpy={onChangeSpy} />);

    openList();
    fireEvent.change(input(), { target: { value: "item-a" } });

    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["item-a"]);

    fireEvent.click(screen.getByRole("option", { name: "item-a" }));

    expect(onChangeSpy).toHaveBeenCalledExactlyOnceWith("item-a");
    expect(input()).toHaveValue("item-a");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("matches scattered characters fuzzily and ranks contiguous matches first", () => {
    render(
      <Harness items={["google/gemini-flash-latest", "gfl-tool", "anthropic/claude-sonnet"]} />,
    );

    openList();
    fireEvent.change(input(), { target: { value: "gfl" } });

    // "gfl" is contiguous in gfl-tool and scattered in google/gemini-flash-latest;
    // the contiguous match ranks first, the non-match is filtered out
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "gfl-tool",
      "google/gemini-flash-latest",
    ]);
  });

  it("offers unmatched typed text as a custom row when allowed and commits it on select", () => {
    const onChangeSpy = vi.fn();
    render(<Harness allowCustomValue onChangeSpy={onChangeSpy} />);

    openList();
    fireEvent.change(input(), { target: { value: "something-else" } });

    fireEvent.click(screen.getByRole("option", { name: 'Use "something-else"' }));

    expect(onChangeSpy).toHaveBeenCalledExactlyOnceWith("something-else");
    expect(input()).toHaveValue("something-else");
  });

  it("shows a no-match message instead of a custom row when custom values are not allowed", () => {
    render(<Harness />);

    openList();
    fireEvent.change(input(), { target: { value: "something-else" } });

    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByText("No matches found.")).toBeInTheDocument();
  });

  it("commits the empty string via the empty-value row", () => {
    const onChangeSpy = vi.fn();
    render(<Harness initial="item-b" emptyValueLabel="Use default" onChangeSpy={onChangeSpy} />);

    openList();
    fireEvent.click(screen.getByRole("option", { name: "Use default" }));

    expect(onChangeSpy).toHaveBeenCalledExactlyOnceWith("");
    expect(input()).toHaveValue("");
    expect(input()).toHaveAttribute("placeholder", "Pick one");
  });

  it("hides the empty-value row when no label is provided, and Enter with an empty value is a no-op", () => {
    const onChangeSpy = vi.fn();
    render(<Harness onChangeSpy={onChangeSpy} />);

    const options = openList();
    expect(options.map((o) => o.textContent)).toEqual(ITEMS);

    // Nothing is highlighted (the seed matches no row), so Enter must not
    // commit the first item.
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onChangeSpy).not.toHaveBeenCalled();
  });

  it("regression: keeps native key handling while the popover is closed, ArrowDown opens it", () => {
    render(<Harness initial="item-b" />);

    // Not swallowed by cmdk while closed (preventDefault would return false)
    expect(fireEvent.keyDown(input(), { key: "Home" })).toBe(true);
    expect(fireEvent.keyDown(input(), { key: "End" })).toBe(true);
    expect(fireEvent.keyDown(input(), { key: "Enter" })).toBe(true);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("shows the loading row only while empty, otherwise keeps showing items", () => {
    const { rerender } = render(<Harness items={[]} isLoading />);

    fireEvent.mouseDown(input());
    fireEvent.focus(input());
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    rerender(<Harness items={ITEMS} isLoading />);
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(ITEMS.length);
  });
});
