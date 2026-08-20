---
name: nixmac-ds
description: "The nixmac design system — a dark-first, monochrome-neutral UI language with a lime brand accent and a signature teal build glow, built for nixmac (an AI-powered nix-darwin config manager). Copy-in React components styled with inline styles over CSS-variable tokens (no Tailwind, no runtime deps beyond React). Use this whenever building any nixmac app or UI such as landing pages, dashboards, agent/diff review screens, settings, forms, onboarding, or any screen that should look and feel like nixmac. This is the canonical source for nixmac components, tokens, theming (dark + light), fonts, and layout — prefer it over generic shadcn/ui."
metadata:
  v0.kind: design-system
---

# nixmac design system

nixmac is "nix-darwin, but visible" — an AI agent that reads a plain-English request, edits your Nix config, shows a diff, and builds it. The design system is **dark-first and terminal-adjacent**: a pure-neutral (hue 0) monochrome base, a single **lime `--brand`** accent, a **teal `--glow-teal`** used only for the "Build & Test" action, and Monaco-style **diff colors** (teal added / rose removed). Display and UI type is **Inter Variable**; code, file paths, hashes, and terminal output are **Geist Mono Variable**.

This skill is the canonical UI source for nixmac. Prefer it over generic shadcn/ui. Do not swap in Tailwind utility classes, other component libraries, or invented tokens.

## What this is (and how it's consumed)

A **copy-in** React component library (shadcn-style): components live in the app's own tree at `components/nixmac/` and are imported via `@/components/nixmac`. There is **no npm package** — never `pnpm add` it or invent a package name. Components are plain `.jsx`, styled entirely with **inline `style={{}}` referencing CSS-variable tokens** from `components/nixmac/tokens/*.css`. The only runtime dependency is React; the starter also uses `lucide-react` for icons.

## Setup — the starter is already wired

New nixmac chats start from the bundled starter (in `assets/starter/`), so the foundation is already in place. **Do not re-create it.** It already has:

- `components/nixmac/` — all 25 components + `tokens/` + `styles.css` (the design system, copied in).
- `app/globals.css` — links `@import "../components/nixmac/styles.css"` (which pulls in fonts + all tokens) and sets the baseline `body` look.
- `app/layout.tsx` — mounts `ThemeProvider` and sets `<html class="dark">` (dark is the ship default).
- `components/theme-provider.tsx` — class-based dark/light provider + `useTheme()` hook.

Your job is to **build on it**: add routes/pages and compose components. Only touch the scaffold (globals, provider, tokens) when a change must be inherited system-wide.

### Import rules

```tsx
// Components — always from the barrel, via @/
import {
  Button, ButtonGlow, BadgeButton,
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
  Badge, Alert, Kbd, Spinner, FileBadge, Separator,
  Input, Textarea, Switch, Checkbox, Label,
  Tabs, TabsList, TabsTrigger, TabsContent,
  NixmacMark,
} from "@/components/nixmac";
```

- The barrel (`components/nixmac/index.js`) is marked `"use client"`. These components use hooks/state and are **client components** — put `"use client"` at the top of any page/component that renders them, or keep them inside a client subtree.
- Never import from internal file paths (`@/components/nixmac/buttons/Button.jsx`) — always the barrel.
- Never import token CSS into individual modules; `styles.css` is linked once in `globals.css`.

## Source of truth

- Components: `assets/starter/components/nixmac/**` — real, validated source. Props and variants are defined there and mirrored in `.d.ts` files next to each component.
- Tokens: `assets/starter/components/nixmac/tokens/*.css` — every color, type, spacing, radius, and effect value.
- When in doubt, read the component source. Do not guess prop names, variants, or token names.

## Routing — read the reference for the task

- **Colors, theming, dark/light, brand, glow, diff** → `references/foundations/colors.md`
- **Typography, fonts, type scale** → `references/foundations/typography.md`
- **Spacing, radii, layout, responsiveness** → `references/foundations/spacing-layout.md`
- **Motion & the signature glow effects** → `references/foundations/motion.md`
- **Component catalog (all 25, grouped)** → `references/components/index.md`, then the per-area files (`buttons.md`, `forms.md`, `feedback.md`, `data-display.md`, `navigation.md`, `brand.md`)
- **Assets (logos, mark, provider icons, mascot)** → `references/assets/index.md`
- **Full validated screen** → `references/examples/agent-diff-review.md`
- **Cross-cutting screen composition** → `references/patterns.md`

## Hard rules

- **Use tokens, never raw values.** Colors, spacing, radii, type, and shadows all come from CSS variables (`var(--brand)`, `var(--card)`, `var(--radius-lg)`, `var(--text-sm)`, `var(--space-4)`). Never hard-code hex/px where a token exists.
- **Dark is the default.** Ship with `<html class="dark">`. Light is supported (remove `.dark`), so provide a toggle only when the product wants one; never invent a third theme.
- **The teal glow is reserved.** `ButtonGlow` and `--glow-teal`/`--teal-glow` signal the primary "build/run" action. Don't scatter it on ordinary buttons.
- **The lime `--brand` is the single accent.** Use it for brand moments (mark, key CTA halo), not as a general fill.
- **Geist Mono for machine text.** File paths, package names, hashes, diffs, terminal/agent output use `var(--font-mono)`. UI copy uses Inter (`var(--font-sans)`).
- **Respect the diff palette.** Added = `--diff-added` (teal), removed = `--diff-removed` (rose). Don't use generic green/red for diffs.
- Never invent components, props, variants, or tokens. If something isn't in the source, mark it `[VERIFY]` and check the source rather than guessing.

## Final checks

Before finishing any nixmac screen:

1. Renders correctly in **dark** (the default); if a light toggle exists, verify light too.
2. All colors/spacing/radii/type come from **tokens**, not literals.
3. Components imported from `@/components/nixmac` (the barrel), and the rendering page/subtree is a **client component**.
4. Machine text is **Geist Mono**; UI text is **Inter**.
5. The teal glow appears only on the primary build/run action; the lime brand is used sparingly.
6. Layout uses the system's spacing scale and stays responsive (see `foundations/spacing-layout.md`).
