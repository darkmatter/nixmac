// Ambient declaration so `tsc` resolves Vite's `?raw` query imports for the SVGs
// in this folder. Vite handles these at build time; this just satisfies the type
// checker (more specific than vite/client's `*?raw`, so it always wins).
declare module "*.svg?raw" {
  const content: string;
  export default content;
}
