import { createHash } from "node:crypto";

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
   * Enable treeshaking of Wasm files using Binaryen's wasm-metadce.
   *
   * @default false
   */
  treeshake?: boolean;

  /**
   * Path to wasm-metadce binary. Defaults to `which wasm-metadce` from the
   * system.
   *
   */
  wasmMetaDCE?: string;
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
