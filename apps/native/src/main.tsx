import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { APP_NAME, APP_OVERLAY_ICON } from "../shared/constants";

function handleOpenMain() {
  window.darwinAPI?.peek.hide?.();
}

function Overlay() {
  return (
    <button
      className="flex h-[120px] w-[120px] items-center justify-center bg-transparent"
      onClick={handleOpenMain}
      type="button"
    >
      <img
        alt={APP_NAME}
        className="h-full w-full select-none object-contain"
        draggable={false}
        height={120}
        src={APP_OVERLAY_ICON}
        width={120}
      />
    </button>
  );
}

const isOverlay = window.location.hash === "#overlay";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>{isOverlay ? <Overlay /> : <App />}</React.StrictMode>,
);
