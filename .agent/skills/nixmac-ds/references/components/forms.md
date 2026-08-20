# Forms

Source: `assets/starter/components/nixmac/forms/`. All fields are 36px tall (except Textarea), 6px radius, transparent fill, border that brightens to `--ring` on focus.

## Input

```tsx
import { Input, Label } from "@/components/nixmac";

<Label htmlFor="host">Hostname</Label>
<Input id="host" placeholder="my-macbook" />
<Input disabled value="/etc/nix/nix.conf" />
```

Single-line `<input>`. Spreads all native props (`value`, `onChange`, `placeholder`, `type`, `id`…). `disabled` dims + blocks. Full-width by default (`width: 100%`).

## Textarea

The prompt composer's core input. Min 60px, vertical resize.

```tsx
import { Textarea } from "@/components/nixmac";

<Textarea placeholder="Describe the change you want…" rows={3} />
<Textarea mono defaultValue={"{ pkgs, ... }: {\n  programs.direnv.enable = true;\n}"} />
```

- `mono` (default `false`): switch to `var(--font-mono)` for config/diff/terminal content. Turn it on any time the text is machine content.
- Spreads native textarea props.

## Switch

Toggle for settings booleans, login items, opt-in flags. 32×18 track.

```tsx
import { Switch, Label } from "@/components/nixmac";

const [on, setOn] = useState(true);
<Label><Switch checked={on} onCheckedChange={setOn} /> Start at login</Label>

<Switch defaultChecked />            {/* uncontrolled */}
```

- Controlled (`checked` + `onCheckedChange`) or uncontrolled (`defaultChecked`). `disabled` supported.
- `role="switch"` with `aria-checked` — accessible by default.

## Checkbox

16px box for multi-select lists and consent rows.

```tsx
import { Checkbox, Label } from "@/components/nixmac";

const [agree, setAgree] = useState(false);
<Label><Checkbox checked={agree} onCheckedChange={setAgree} /> Apply to all hosts</Label>
```

- Same controlled/uncontrolled + `disabled` pattern as Switch. `role="checkbox"` + `aria-checked`. Shows a check glyph when on.

## Label

14px medium label. Pair with any field; use `htmlFor` to bind, or wrap the control to make the whole row clickable.

```tsx
<Label htmlFor="path">Store path</Label>
<Label disabled>Unavailable</Label>
```

- `disabled` dims to match a disabled field.

**Common mistakes**: `Switch`/`Checkbox` take `onCheckedChange(nextBoolean)`, not `onChange`. Use `mono` on Textarea for config, not a manual `fontFamily`.
