# Component catalog

25 components, all exported from the barrel `@/components/nixmac` and defined under `assets/starter/components/nixmac/`. Every component takes `style` (merged last, so you can override) and spreads remaining props to its root element. All are **client components** — render them inside a `"use client"` tree.

| Area | Components | Reference |
| --- | --- | --- |
| Buttons | `Button`, `ButtonGlow`, `BadgeButton` | `buttons.md` |
| Forms | `Input`, `Textarea`, `Switch`, `Checkbox`, `Label` | `forms.md` |
| Feedback | `Alert`, `Spinner`, `Badge` (status) | `feedback.md` |
| Data display | `Card` (+`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter`), `Badge`, `Kbd`, `FileBadge`, `Separator` | `data-display.md` |
| Navigation | `Tabs` (+`TabsList`/`TabsTrigger`/`TabsContent`) | `navigation.md` |
| Brand | `NixmacMark` | `brand.md` |

Conventions shared by all:
- Styling is inline `style={{}}` over CSS-variable tokens; there are no `className` variants. To restyle, pass `style` (it wins) — but stick to tokens.
- Controlled/uncontrolled: `Switch`, `Checkbox`, and `Tabs` support both (`checked`/`defaultChecked` + `onCheckedChange`; `value`/`defaultValue` + `onValueChange`).
- Icons: pass lucide-react nodes to `icon` props (`BadgeButton`, `Alert`, `FileBadge`). Size them to the slot (12–16px).
- Never import a component from its file path; use the barrel.
