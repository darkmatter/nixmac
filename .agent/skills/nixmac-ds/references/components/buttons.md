# Buttons

Source: `assets/starter/components/nixmac/buttons/`.

## Button

The primary action button. Native-macOS feel: 36px default height, 6px radius, subtle hover tint, `scale(0.98)` press.

```tsx
import { Button } from "@/components/nixmac";

<Button>Apply</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="outline">Details</Button>
<Button variant="ghost" size="sm">Dismiss</Button>
<Button variant="destructive">Delete config</Button>
<Button variant="link">Learn more</Button>
<Button size="icon" aria-label="Settings"><Settings size={16} /></Button>
```

- `variant`: `default` | `secondary` | `outline` | `ghost` | `link` | `destructive`. Default is the solid light `--primary` button.
- `size`: `sm` (32) | `default` (36) | `lg` (40) | `icon` (36²) | `icon-sm` (32²) | `icon-lg` (40²).
- `disabled`: dims to 0.5 and disables pointer events.
- Renders a real `<button type="button">`; spreads props (`onClick`, `aria-*`). For icon-only buttons always pass `aria-label`.
- **Common mistakes**: don't use `Button` for the build/run action (use `ButtonGlow`); don't recolor `default` to lime/teal — those are reserved.

## ButtonGlow — the signature build/run pill

A dark capsule inside an animated rotating **teal** glow ring. Reserved for the primary "Build & Test" / apply / run action.

```tsx
import { ButtonGlow } from "@/components/nixmac";

<ButtonGlow />                      {/* defaults to a spinner icon + "Build & Test" */}
<ButtonGlow onClick={run}>Scan this Mac</ButtonGlow>
<ButtonGlow active={false}>Build &amp; Test</ButtonGlow>   {/* disabled/idle: desaturated grey ring */}
```

- `active` (default `true`): when true the teal ring rotates (ambient 5s) and the button is enabled; when false it desaturates to grey and is disabled.
- `children`: label (and optional leading icon). Omit to get the default spinner + "Build & Test".
- Use **once** per view, on the highest-signal action. See `foundations/motion.md`.
- **Never invent**: there is no `variant`/`size`/color prop — the teal is fixed. Don't wrap ordinary buttons in it.

## BadgeButton — prompt chip

A small bordered rounded-full "chip button" for prompt suggestions, filters, and inline actions in a prompt bar.

```tsx
import { BadgeButton } from "@/components/nixmac";
import { Sparkles } from "lucide-react";

<BadgeButton icon={<Sparkles size={12} />}>Install direnv</BadgeButton>
<BadgeButton badgeVariant="muted">Enable Touch ID for sudo</BadgeButton>
<BadgeButton badgeVariant="teal">Optimize Nix store</BadgeButton>
```

- `badgeVariant`: `default` | `muted` | `teal` (three quiet border treatments; `teal` faintly references the glow).
- `icon`: optional 12px leading node.
- `disabled`: supported.
- Renders a `<button>`; xs mono-height pill. For suggestions, keep labels short and imperative.
