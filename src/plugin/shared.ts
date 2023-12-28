import { createHash } from "node:crypto";

export interface UnwasmPluginOptions {
  /**
   * Direct import the wasm file instead of bundling, required in Cloudflare Workers
   *
   * @default false
   */
  esmImport?: boolean;

  /**
   * Import `.wasm` files using a lazily evaluated promise for compatibility with runtimes without top-level await support
   *
   * @default false
   */
  lazy?: boolean;
}

export type WasmAsset = {
  id: string;
  name: string;
  source: Buffer;
};

export const UNWASM_EXTERNAL_PREFIX = "\0unwasm:external:";
export const UMWASM_HELPERS_ID = "\0unwasm:helpers";

export function sha1(source: Buffer) {
  return createHash("sha1").update(source).digest("hex").slice(0, 16);
}
