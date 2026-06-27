import type { ReactNode } from "react";

interface StepShellProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Shared header/body/footer scaffold for every onboarding step. */
export function StepShell({ eyebrow: _eyebrow, title: _title, description, children, footer }: StepShellProps) {
  return (
    <div className="flex h-full flex-col">
      <header className="mb-6">
        {/* <p className="mb-2 font-medium text-primary text-xs uppercase tracking-widest">{eyebrow}</p> */}
        {/* <h1 className="text-pretty font-semibold text-2xl tracking-tight">{title}</h1> */}
        <p className="mt-2 max-w-prose text-pretty text-muted-foreground leading-relaxed">
          {description}
        </p>
      </header>

      <div className="flex-1">{children}</div>

      {footer ? (
        <footer className="mt-8 flex items-center justify-end gap-3 border-border border-t pt-5">
          {footer}
        </footer>
      ) : null}
    </div>
  );
}
