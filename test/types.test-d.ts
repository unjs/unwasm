import type { Plugin as RollupPlugin } from "rollup";
import type { PluginOption as VitePlugin } from "vite";
import type { unwasm } from "../src/plugin";

// unwasm's own types must not depend on rollup, but the plugin it returns has
// to stay structurally compatible with rollup (and vite, which extends it).
type UnwasmPlugin = ReturnType<typeof unwasm>;

/** Fails to typecheck unless `T` is exactly `true`. */
type Assert<T extends true> = T;

export type _AssertRollupCompatible = Assert<
  UnwasmPlugin extends RollupPlugin ? true : false
>;

export type _AssertViteCompatible = Assert<
  UnwasmPlugin extends VitePlugin ? true : false
>;
