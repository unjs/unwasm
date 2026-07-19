import { createHash } from "node:crypto";
import type { ExternalKind } from "../tools";

export interface UnwasmPluginOptions {
  /**
   * Directly import the `.wasm` files instead of bundling as base64 string.
   *
   * @default false
   */
  esmImport?: boolean;

  /**
   * Avoid using top level await and always use a proxy.
   *
   * Useful for compatibility with environments that don't support top level await.
   *
   * @default false
   */
  lazy?: boolean;

  /**
   * Suppress all warnings from the plugin.
   *
   * @default false
   */
  silent?: boolean;
}

/** A single entry the wasm module expects from one imported JS module. */
export type WasmImport = {
  name: string;
  type: ExternalKind;
};

export type WasmAsset = {
  id: string;
  name: string;
  source: Buffer;
  imports: Record<string, WasmImport[]>;
  exports: string[];
};

export const UNWASM_EXTERNAL_PREFIX = "\0unwasm:external:";
export const UNWASM_EXTERNAL_RE = /(\0|\\0)unwasm:external:([^"']+)/gu;
export const UMWASM_HELPERS_ID = "\0unwasm:helpers";

export function sha1(source: Buffer) {
  return createHash("sha1").update(source).digest("hex").slice(0, 16);
}

export function escapeRegExp(string: string): string {
  return string.replace(/[-\\^$*+?.()|[\]{}]/g, String.raw`\$&`);
}
