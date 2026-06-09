// Entry point for the experimental "evolve mascot" indicator window.
//
// A standalone always-on-top, transparent, corner-pinned window (created and
// positioned by the Rust `peek` module, mirroring the preview indicator).
// Visibility is driven entirely from Rust via show/hide commands, so the window
// content is intentionally static: whenever the window is on screen we want the
// token turning. It renders the realistic 3D NixmacMascot3D in its continuous
// turntable ("spinning") mode — no event/state plumbing required here.
import React from "react";
import ReactDOM from "react-dom/client";
import { NixmacMascot3D } from "@/components/nixmac-mascot/NixmacMascot3D";
import "./index.css";

function EvolveMascotWindow() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <NixmacMascot3D size={160} spinning />
    </div>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <EvolveMascotWindow />
    </React.StrictMode>,
  );
}
