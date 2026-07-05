// Realistic 3D nixmac token — react-three-fiber + three.
//
// Renders the nixmac icon as a physical object: a rounded, beveled slab (real
// geometry, so the edges catch light) with the mascot face on the front, the
// device panel on the back, and dark metallic sides. Lit by a procedural
// environment (no network fetch) so the bevels read as a solid object, and it
// turns continuously on its Y axis (turntable) for the busy indicator.
//
// three.js is imported ONLY here, so it never enters the main app bundle — the
// evolve-mascot indicator window is the sole consumer.
import { Environment, Lightformer, RoundedBox } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import backSvg from "./nixmac-mascot-back.svg?raw";
import frontSvg from "./nixmac-mascot.svg?raw";

// Both face SVGs share this viewBox (441 × 406).
const ASPECT = 441 / 406;

/** One full hop+spin cycle (s) — matches the CSS `--hop-period`: mostly idle, with a hop. */
const HOP_PERIOD_S = 8;

// Hop + 360° Y-spin keyframes, ported 1:1 from `nixmac-cube-hop`:
// [phase 0..1, CSS translateY %, Y rotation °, scaleX, scaleY].
// translateY % is CSS (positive = down) and is flipped to world +y (up) below.
const HOP_KEYS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0.0, 0, 0, 1, 1],
  [0.66, 0, 0, 1, 1], // idle
  [0.7, 3, 0, 1.08, 0.92], // crouch
  [0.74, -4, 0, 0.94, 1.06], // takeoff
  [0.82, -16, 180, 1, 1], // peak — back to camera
  [0.9, 0, 352, 1.08, 0.92], // land
  [0.93, 0, 360, 0.98, 1.02], // rebound
  [0.96, 0, 360, 1, 1],
  [1.0, 0, 360, 1, 1], // settle
];

/** Piecewise-linear sample of the hop keyframes at cycle phase `t` (0..1). */
function sampleHop(t: number): { yPct: number; rotDeg: number; sx: number; sy: number } {
  let i = 0;
  while (i < HOP_KEYS.length - 1 && t > HOP_KEYS[i + 1][0]) i++;
  const a = HOP_KEYS[i];
  const b = HOP_KEYS[Math.min(i + 1, HOP_KEYS.length - 1)];
  const span = b[0] - a[0] || 1;
  const f = Math.min(Math.max((t - a[0]) / span, 0), 1);
  const lerp = (x: number, y: number) => x + (y - x) * f;
  return {
    yPct: lerp(a[1], b[1]),
    rotDeg: lerp(a[2], b[2]),
    sx: lerp(a[3], b[3]),
    sy: lerp(a[4], b[4]),
  };
}

/** Rasterize a raw SVG string into an sRGB CanvasTexture (alpha preserved). */
function svgToTexture(rawSvg: string, width = 1024): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([rawSvg], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const height = Math.round(width / ASPECT);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("2d context unavailable"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      resolve(texture);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("failed to rasterize svg"));
    };
    img.src = url;
  });
}

function useSvgTexture(rawSvg: string): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let live = true;
    svgToTexture(rawSvg)
      .then((t) => {
        if (live) setTexture(t);
      })
      .catch(() => {
        /* leave the dark body face showing if rasterization fails */
      });
    return () => {
      live = false;
    };
  }, [rawSvg]);
  return texture;
}

function Token({ spinning }: { spinning: boolean }) {
  const spin = useRef<THREE.Group>(null);
  const front = useSvgTexture(frontSvg);
  const back = useSvgTexture(backSvg);

  // A true cube — equal width, height, depth — matching the previous CSS cube.
  const edge = 1.4;
  const faceW = edge * 0.98;
  const faceH = faceW / ASPECT; // keep the icon's aspect, centered on the square face

  // Drive the intermittent hop + 360° Y spin (matching nixmac-cube-hop): mostly
  // idle, then crouch → hop → spin → land → settle, once per HOP_PERIOD_S. No
  // constant tilt — the perspective comes from the camera.
  useFrame((state) => {
    const g = spin.current;
    if (!g) return;
    if (!spinning) {
      g.position.y = 0;
      g.rotation.y = 0;
      g.scale.set(1, 1, 1);
      return;
    }
    const t = (state.clock.elapsedTime % HOP_PERIOD_S) / HOP_PERIOD_S;
    const k = sampleHop(t);
    g.position.y = -(k.yPct / 100) * edge; // CSS translateY% (down+) → world y (up+)
    g.rotation.y = (k.rotDeg * Math.PI) / 180;
    g.scale.set(k.sx, k.sy, k.sx); // squash/stretch: x & z together, y opposite
  });

  return (
    <group ref={spin}>
      {/* Cube body: rounded corners + beveled edges, lightly metallic. */}
      <RoundedBox args={[edge, edge, edge]} radius={0.12} smoothness={5}>
        <meshStandardMaterial color="#15171c" metalness={0.6} roughness={0.35} />
      </RoundedBox>
      {/* Front face: the mascot, inset just above the body's front face. */}
      {front && (
        <mesh position={[0, 0, edge / 2 + 0.006]}>
          <planeGeometry args={[faceW, faceH]} />
          <meshStandardMaterial map={front} transparent metalness={0.05} roughness={0.5} />
        </mesh>
      )}
      {/* Back face: device panel, facing away. */}
      {back && (
        <mesh position={[0, 0, -edge / 2 - 0.006]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[faceW, faceH]} />
          <meshStandardMaterial map={back} transparent metalness={0.05} roughness={0.5} />
        </mesh>
      )}
    </group>
  );
}

interface NixmacMascot3DProps {
  /** Rendered square size in px. Default 160. */
  size?: number;
  /** Turn continuously on the Y axis (the busy/indicator state). */
  spinning?: boolean;
  className?: string;
}

export function NixmacMascot3D({ size = 160, spinning = false, className }: NixmacMascot3DProps) {
  return (
    <div className={className} style={{ width: size, height: size }} aria-label="nixmac mascot">
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0, 4.2], fov: 30 }}
        // alpha: transparent so the token floats in the borderless window.
        // preserveDrawingBuffer: keeps the frame readable for screenshots/compositing.
        gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
        style={{ background: "transparent" }}
      >
        <ambientLight intensity={0.45} />
        <directionalLight position={[4, 5, 6]} intensity={1.5} />
        <directionalLight position={[-5, -1, -4]} intensity={0.5} />
        {/* Procedural IBL — gives the metallic bevels something to reflect, no network. */}
        <Environment resolution={128} frames={1}>
          <Lightformer form="rect" intensity={3} position={[3, 3, 4]} scale={[5, 5, 1]} />
          <Lightformer form="rect" intensity={1.5} position={[-4, 2, 2]} scale={[4, 4, 1]} />
          <Lightformer form="ring" intensity={1.2} position={[0, -3, 3]} scale={[3, 3, 1]} />
        </Environment>
        <Token spinning={spinning} />
      </Canvas>
    </div>
  );
}

