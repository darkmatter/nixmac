import styles from "@/app/page.module.css";

const COLORS: { name: string; token: string; value: string; border?: boolean }[] = [
  { name: "Background", token: "--background", value: "var(--background)", border: true },
  { name: "Card", token: "--card", value: "var(--card)", border: true },
  { name: "Muted", token: "--muted", value: "var(--muted)" },
  { name: "Primary", token: "--primary", value: "var(--primary)" },
  { name: "Brand", token: "--brand", value: "var(--brand)" },
  { name: "Teal glow", token: "--glow-teal", value: "var(--glow-teal)" },
  { name: "Diff added", token: "--diff-added", value: "var(--diff-added)" },
  { name: "Diff removed", token: "--diff-removed", value: "var(--diff-removed)" },
  { name: "Success", token: "--success", value: "var(--success)" },
  { name: "Warning", token: "--warning", value: "var(--warning)" },
  { name: "Destructive", token: "--destructive", value: "var(--destructive)" },
  { name: "Border", token: "--border", value: "var(--border)" },
];

const TYPE: { label: string; token: string; size: string; mono?: boolean }[] = [
  { label: "Hero", token: "--text-6xl", size: "var(--text-6xl)" },
  { label: "Title", token: "--text-2xl", size: "var(--text-2xl)" },
  { label: "Body", token: "--text-sm", size: "var(--text-sm)" },
  { label: "darwin-rebuild switch", token: "--font-mono", size: "var(--text-sm)", mono: true },
];

const RADII: { label: string; token: string; value: string }[] = [
  { label: "sm · inputs", token: "--radius-sm", value: "var(--radius-sm)" },
  { label: "md · buttons", token: "--radius-md", value: "var(--radius-md)" },
  { label: "lg · cards", token: "--radius-lg", value: "var(--radius-lg)" },
  { label: "xl · panels", token: "--radius-xl", value: "var(--radius-xl)" },
];

export function Foundations() {
  return (
    <section className={styles.section} id="foundations">
      <div className={styles.container}>
        <div className={styles.sectionHead}>
          <div className={styles.eyebrow}>foundations</div>
          <h2 className={styles.sectionTitle}>Monochrome, one accent, teal for the build</h2>
          <p className={styles.sectionLede}>
            Pure-gray neutrals in oklch, a single lime brand accent used sparingly, and a signature
            teal glow that marks the &ldquo;build &amp; test&rdquo; moment. Diff colors are
            brand-defining: teal added, rose removed.
          </p>
        </div>

        <div className={styles.gridAuto}>
          {COLORS.map((c) => (
            <div key={c.token} className={styles.swatch}>
              <div
                className={styles.swatchColor}
                style={{
                  background: c.value,
                  boxShadow: c.border ? "inset 0 0 0 1px var(--border)" : undefined,
                }}
              />
              <div className={styles.swatchMeta}>
                <span className={styles.swatchName}>{c.name}</span>
                <span className={styles.swatchToken}>{c.token}</span>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.grid2} style={{ marginTop: "var(--space-6)" }}>
          <div className={styles.swatch} style={{ padding: "var(--space-5)" }}>
            <div className={styles.eyebrow} style={{ marginBottom: "var(--space-4)" }}>
              type scale — Inter + Geist Mono
            </div>
            {TYPE.map((t) => (
              <div key={t.label} className={styles.typeRow}>
                <span
                  style={{
                    fontSize: t.size,
                    fontFamily: t.mono ? "var(--font-mono)" : "var(--font-sans)",
                    fontWeight: 600,
                    lineHeight: 1.1,
                    letterSpacing: t.mono ? 0 : "-0.01em",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.label}
                </span>
                <span className={styles.typeToken}>{t.token}</span>
              </div>
            ))}
          </div>

          <div className={styles.swatch} style={{ padding: "var(--space-5)" }}>
            <div className={styles.eyebrow} style={{ marginBottom: "var(--space-4)" }}>
              corner radii — base 0.5rem
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "var(--space-5)",
                alignItems: "flex-end",
              }}
            >
              {RADII.map((r) => (
                <div
                  key={r.token}
                  style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
                >
                  <div
                    style={{
                      width: 76,
                      height: 56,
                      borderRadius: r.value,
                      background: "var(--muted)",
                      border: "1px solid var(--border)",
                    }}
                  />
                  <span className={styles.swatchToken}>{r.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
