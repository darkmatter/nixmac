import React from "react";

let spinInjected = false;
function useSpin() {
  React.useEffect(() => {
    if (spinInjected) return;
    spinInjected = true;
    const el = document.createElement("style");
    el.textContent = "@keyframes nixmac-spin{to{transform:rotate(360deg)}}";
    document.head.appendChild(el);
  }, []);
}

/** Loading spinner — a spinning lucide-style loader at `size` (px). */
export function Spinner({ size = 16, style, ...props }) {
  useSpin();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="status"
      aria-label="Loading"
      style={{ animation: "nixmac-spin 1s linear infinite", ...style }}
      {...props}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
