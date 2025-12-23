// biome-ignore lint/performance/noBarrelFile: Barrel file is necessary for export
export { z } from "zod";
export * from "./extra-schemas";
export * from "./parse-env";
export * from "./preprocessors";
export type { DeepReadonly, DeepReadonlyArray, DeepReadonlyObject } from "./util/type-helpers";

import { type ParseEnv, parseEnvImpl } from "./parse-env";

// This entrypoint provides a colorized reporter by default; this requires tty
// detection, which in turn relies on Node's built-in `tty` module.

/**
 * Parses the passed environment object using the provided map of Zod schemas
 * and returns the immutably-typed, parsed environment.
 */
export const parseEnv: ParseEnv = (env, schemas, reporterOrTokenFormatters = {}) =>
  parseEnvImpl(env, schemas, reporterOrTokenFormatters);
