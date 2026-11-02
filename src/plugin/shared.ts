import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

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

  /**
   * Compress `.wasm` files with gzip before encoding them as base64 strings.
   *
   * @default false
   */
  compress?: boolean;
}

export type WasmAsset = {
  id: string;
  name: string;
  source: Buffer;
  imports: Record<string, string[]>;
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

export function gzip(source: Buffer): Buffer {
  return gzipSync(source);
}
