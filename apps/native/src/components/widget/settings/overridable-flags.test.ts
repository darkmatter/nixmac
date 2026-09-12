import { describe, expect, it } from "vitest";

import { OVERRIDABLE_FLAGS } from "@/components/widget/settings/overridable-flags";
import { MENU_BAR_POPOVER_FLAG } from "@/lib/menu-bar-popover-flag";

describe("OVERRIDABLE_FLAGS", () => {
  it("does not offer a duplicate explicit control choice for the menu bar flag", () => {
    const flag = OVERRIDABLE_FLAGS.find(({ key }) => key === MENU_BAR_POPOVER_FLAG);

    expect(flag).toBeDefined();
    expect(flag?.options).toEqual([{ value: "popover", label: "Popover" }]);
    expect(flag?.defaultLabel).toBe("Default (control)");
  });
});
