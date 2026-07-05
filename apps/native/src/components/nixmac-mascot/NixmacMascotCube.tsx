// Animated nixmac mascot — CSS 3D cube.
//
// A real 6-face cube (perspective + preserve-3d). The front face reuses the
// animated <NixmacMascot> (its blink/smile/pulse keep running); the cube hops and
// turns on its Y axis to reveal a device-style back face and the dark side edges.
//
// This is genuine 3D — it deliberately does NOT use Lottie (Lottie is 2D and can't
// represent a cube). All motion lives in nixmac-mascot-cube.css.
//
//   <NixmacMascotCube size={200} />
import type { CSSProperties } from "react";
import { NixmacMascot } from "./NixmacMascot";
import backSvg from "./nixmac-mascot-back.svg?raw";
import "./nixmac-mascot-cube.css";

interface NixmacMascotCubeProps {
  /** Rendered cube edge in px. Default 160. */
  size?: number;
  className?: string;
}

export function NixmacMascotCube({ size = 160, className }: NixmacMascotCubeProps) {
  return (
    <div
      className={className ? `nixmac-cube-scene ${className}` : "nixmac-cube-scene"}
      style={{ "--cube-size": `${size}px` } as CSSProperties}
    >
      <div className="nixmac-cube">
        <div className="nixmac-cube__face nixmac-cube__face--front">
          <NixmacMascot size={size} />
        </div>
        {/* device-style back — static dark panel, no facial features */}
        <div
          className="nixmac-cube__face nixmac-cube__face--back"
          dangerouslySetInnerHTML={{ __html: backSvg }}
        />
        {/* the four dark edges that give the cube its depth */}
        <div className="nixmac-cube__face nixmac-cube__face--right" />
        <div className="nixmac-cube__face nixmac-cube__face--left" />
        <div className="nixmac-cube__face nixmac-cube__face--top" />
        <div className="nixmac-cube__face nixmac-cube__face--bottom" />
      </div>
    </div>
  );
}

