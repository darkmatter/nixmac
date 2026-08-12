"use client";

import { Moon, Sun, Sparkles } from "lucide-react";
import { Button, NixmacMark } from "@/components/nixmac";
import { useTheme } from "@/components/theme-provider";
import styles from "@/app/page.module.css";

export function TopNav() {
  const { theme, toggle } = useTheme();
  return (
    <header className={styles.nav}>
      <div className={`${styles.container} ${styles.navInner}`}>
        <a className={styles.brand} href="#top">
          <NixmacMark size={26} />
          <span>nixmac</span>
        </a>

        <nav className={styles.navLinks} aria-label="Primary">
          <a href="#foundations">Foundations</a>
          <a href="#components">Components</a>
          <a href="#compose">Patterns</a>
        </nav>

        <div className={styles.navActions}>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </Button>
          <Button size="sm">
            <Sparkles size={14} /> Evolve this Mac
          </Button>
        </div>
      </div>
    </header>
  );
}
