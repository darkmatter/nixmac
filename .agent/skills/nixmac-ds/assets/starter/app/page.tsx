import { TopNav } from "@/components/site/top-nav";
import { Hero } from "@/components/site/hero";
import { Foundations } from "@/components/site/foundations";
import { Showcase } from "@/components/site/showcase";
import { Footer } from "@/components/site/footer";
import styles from "@/app/page.module.css";

export default function Page() {
  return (
    <div className={styles.page}>
      <TopNav />
      <main>
        <Hero />
        <Foundations />
        <Showcase />
      </main>
      <Footer />
    </div>
  );
}
