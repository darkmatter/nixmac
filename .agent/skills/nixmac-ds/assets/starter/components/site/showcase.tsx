import { Check, FileCode, Info, Sparkles, TriangleAlert } from "lucide-react";
import {
  Alert,
  Badge,
  BadgeButton,
  Button,
  ButtonGlow,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  FileBadge,
  Input,
  Kbd,
  Label,
  Separator,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@/components/nixmac";
import styles from "@/app/page.module.css";

const DIFF: { t: "add" | "rem" | "ctx"; s: string }[] = [
  { t: "ctx", s: "  system.defaults.dock = {" },
  { t: "rem", s: "-   autohide = false;" },
  { t: "add", s: "+   autohide = true;" },
  { t: "add", s: "+   autohide-delay = 0.0;" },
  { t: "ctx", s: "  };" },
];

export function Showcase() {
  return (
    <section className={styles.section} id="components">
      <div className={styles.container}>
        <div className={styles.sectionHead}>
          <div className={styles.eyebrow}>components</div>
          <h2 className={styles.sectionTitle}>Primitives, composed the way the app uses them</h2>
          <p className={styles.sectionLede}>
            The same buttons, forms, tabs, and cards that build nixmac&apos;s prompt composer,
            review panel, and settings — quiet surfaces, hairline borders, and one confident accent.
          </p>
        </div>

        <div className={styles.grid2}>
          {/* Prompt composer */}
          <Card>
            <CardHeader>
              <CardTitle>Describe a change</CardTitle>
              <CardDescription>Plain English in, a checked diff out.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className={styles.stack}>
                <Textarea
                  rows={3}
                  defaultValue="Install Tailscale and make it start at login"
                  placeholder="What should this Mac do?"
                />
                <div className={styles.badgeWrap}>
                  <BadgeButton icon={<Sparkles size={12} />}>Autohide the Dock</BadgeButton>
                  <BadgeButton badgeVariant="teal" icon={<Sparkles size={12} />}>
                    Touch ID for sudo
                  </BadgeButton>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <ButtonGlow>
                <Sparkles size={14} /> Build &amp; test
              </ButtonGlow>
              <Button variant="ghost">Discard</Button>
            </CardFooter>
          </Card>

          {/* Review + diff */}
          <Card style={{ gap: 0, padding: 0, overflow: "hidden" }}>
            <Tabs defaultValue="review">
              <div className={styles.rowBetween} style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
                <TabsList>
                  <TabsTrigger value="review">Review</TabsTrigger>
                  <TabsTrigger value="diff">Diff</TabsTrigger>
                </TabsList>
                <Badge variant="success">
                  <Check size={12} /> build passed
                </Badge>
              </div>
              <TabsContent value="review" style={{ margin: 0, padding: 16 }}>
                <div className={styles.stack}>
                  <div className={styles.rowBetween}>
                    <div>
                      <div style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>
                        Enable Dock autohide
                      </div>
                      <div style={{ fontSize: "var(--text-xs)", color: "var(--muted-foreground)", marginTop: 3 }}>
                        Hides the Dock until you reach for it.
                      </div>
                    </div>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)", color: "var(--muted-foreground)" }}>
                      +3
                    </span>
                  </div>
                  <FileBadge icon={<FileCode size={12} />}>modules/darwin/dock.nix</FileBadge>
                </div>
              </TabsContent>
              <TabsContent value="diff" style={{ margin: 0, padding: 16 }}>
                <div className={styles.diff}>
                  {DIFF.map((l, i) => (
                    <div
                      key={i}
                      className={styles.diffLine}
                      style={{
                        color:
                          l.t === "add"
                            ? "var(--diff-added)"
                            : l.t === "rem"
                              ? "var(--diff-removed)"
                              : "var(--muted-foreground)",
                        background:
                          l.t === "add"
                            ? "color-mix(in oklch, var(--diff-added) 10%, transparent)"
                            : l.t === "rem"
                              ? "color-mix(in oklch, var(--diff-removed) 10%, transparent)"
                              : "transparent",
                      }}
                    >
                      {l.s}
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </Card>

          {/* Settings form */}
          <Card>
            <CardHeader>
              <CardTitle>Login &amp; security</CardTitle>
              <CardDescription>Booleans map to nix-darwin options.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className={styles.stack}>
                <div>
                  <Label htmlFor="host">Hostname</Label>
                  <div style={{ marginTop: "var(--space-2)" }}>
                    <Input id="host" defaultValue="glacier" />
                  </div>
                </div>
                <div className={styles.settingRow}>
                  <div className={styles.settingLabel}>
                    <Label>Touch ID for sudo</Label>
                    <span className={styles.settingHint}>security.pam.enableSudoTouchIdAuth</span>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className={styles.settingRow}>
                  <div className={styles.settingLabel}>
                    <Label>Start Tailscale at login</Label>
                    <span className={styles.settingHint}>services.tailscale.enable</span>
                  </div>
                  <Switch />
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <Checkbox defaultChecked />
                  <span style={{ fontSize: "var(--text-sm)" }}>Commit after apply</span>
                </label>
              </div>
            </CardContent>
            <CardFooter>
              <Button>
                <Check size={15} /> Apply &amp; commit
              </Button>
              <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
                <Kbd>⌘</Kbd>
                <Kbd>↵</Kbd>
              </span>
            </CardFooter>
          </Card>

          {/* Feedback + labels */}
          <Card>
            <CardHeader>
              <CardTitle>States &amp; feedback</CardTitle>
              <CardDescription>Badges, alerts, and inline status.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className={styles.stack}>
                <div className={styles.badgeWrap}>
                  <Badge>default</Badge>
                  <Badge variant="secondary">secondary</Badge>
                  <Badge variant="success">3 changes</Badge>
                  <Badge variant="warning">unsaved</Badge>
                  <Badge variant="brand">flake</Badge>
                  <Badge variant="outline">v24.11</Badge>
                </div>
                <Separator />
                <Alert icon={<Info size={16} />} title="Checks before apply">
                  nixmac runs darwin-rebuild check and shows the diff before anything touches the
                  machine.
                </Alert>
                <Alert
                  variant="destructive"
                  icon={<TriangleAlert size={16} />}
                  title="Could not evaluate modules/darwin/defaults.nix"
                >
                  Attribute &apos;autohide&apos; is not a valid option. Nothing was applied.
                </Alert>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
