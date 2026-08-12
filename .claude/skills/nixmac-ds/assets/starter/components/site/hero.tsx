import { Cpu, Sparkles } from "lucide-react";
import {
  Badge,
  BadgeButton,
  Button,
  ButtonGlow,
  Card,
  CardContent,
  FileBadge,
  NixmacMark,
  Spinner,
} from "@/components/nixmac";
import styles from "@/app/page.module.css";

const STARTERS = [
  "Install Tailscale, start at login",
  "Set the Dock to autohide",
  "Enable Touch ID for sudo",
];

export function Hero() {
  return (
    <section className={styles.container} id="top">
      <div className={styles.hero}>
        <div>
          <Badge variant="brand">nix-darwin, but visible</Badge>
          <h1 className={styles.heroTitle}>Prompt, review, apply, and commit your Mac config.</h1>
          <p className={styles.heroLede}>
            Describe a change in plain English. nixmac reads your Nix config, plans the edit, runs a
            build check, and shows you the diff — before anything touches the machine.
          </p>
          <div className={styles.heroActions}>
            <ButtonGlow>
              <Sparkles size={14} /> Build &amp; test
            </ButtonGlow>
            <Button variant="outline">
              <Cpu size={15} /> Ollama · local
            </Button>
          </div>
          <div className={styles.heroChips}>
            {STARTERS.map((s) => (
              <BadgeButton key={s} icon={<Sparkles size={12} />}>
                {s}
              </BadgeButton>
            ))}
          </div>
        </div>

        <Card style={{ gap: 0, padding: 0, overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              background: "color-mix(in oklch, var(--card) 50%, transparent)",
            }}
          >
            <Spinner size={16} style={{ color: "var(--brand)" }} />
            <span style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>Evolving this Mac…</span>
            <span
              style={{
                marginLeft: "auto",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-xs)",
                color: "var(--muted-foreground)",
              }}
            >
              4s
            </span>
          </div>
          <CardContent style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <TimelineRow label="Read config" detail="modules/darwin/dock.nix" done />
            <TimelineRow label="Planned change" detail="autohide = true" done />
            <TimelineRow label="Build check" detail="darwin-rebuild check" active />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <NixmacMark size={22} />
              <FileBadge>modules/darwin/dock.nix</FileBadge>
              <Badge variant="success" style={{ marginLeft: "auto" }}>
                +3
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function TimelineRow({
  label,
  detail,
  done,
  active,
}: {
  label: string;
  detail: string;
  done?: boolean;
  active?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <span
        style={{
          marginTop: 2,
          display: "inline-flex",
          color: active ? "var(--brand)" : "var(--success)",
        }}
      >
        {active ? <Spinner size={15} /> : <CheckDot />}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>{label}</div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-xs)",
            color: "var(--muted-foreground)",
          }}
        >
          {detail}
        </div>
      </div>
    </div>
  );
}

function CheckDot() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
