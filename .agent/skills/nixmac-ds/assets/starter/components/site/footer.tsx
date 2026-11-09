import { NixmacMark } from "@/components/nixmac";
import styles from "@/app/page.module.css";

export function Footer() {
  return (
    <footer className={styles.footer} id="compose">
      <div className={`${styles.container} ${styles.footerInner}`}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
          <NixmacMark size={20} />
          <span style={{ color: "var(--foreground)", fontWeight: 500 }}>nixmac</span>
          <span>design system</span>
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
          Inter + Geist Mono · oklch · dark-first
        </span>
      </div>
    </footer>
  );
}
