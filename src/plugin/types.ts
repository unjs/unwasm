/**
 * Minimal, dependency-free descriptions of the bundler hooks used by unwasm.
 *
 * These types intentionally mirror (a subset of) the Rollup plugin API so that
 * an {@link UnwasmPlugin} stays structurally assignable to Rollup's `Plugin`
 * (and to Vite's, which extends it) without unwasm's public types depending on
 * rollup itself.
 */

// --- Common ---

export type Awaitable<T> = T | Promise<T>;

export type MaybeArray<T> = T | T[];

export type StringFilter<Value = string | RegExp> =
  | MaybeArray<Value>
  | {
      include?: MaybeArray<Value> | undefined;
      exclude?: MaybeArray<Value> | undefined;
    };

export interface Log {
  message: string;
  id?: string | undefined;
  cause?: unknown | undefined;
}

export interface RawSourceMap {
  file?: string | undefined;
  mappings: string;
  names: string[];
  sourceRoot?: string | undefined;
  sources: string[];
  sourcesContent?: string[] | undefined;
  version: number;
}

export type SourceMapInput = RawSourceMap | string | null | { mappings: "" };

// --- Plugin context ---

export interface EmittedAsset {
  type: "asset";
  fileName?: string | undefined;
  name?: string | undefined;
  source?: string | Uint8Array | undefined;
}

export interface ResolvedId {
  id: string;
  external: boolean | "absolute";
  meta: Record<string, any>;
}

export interface PluginContext {
  addWatchFile: (id: string) => void;
  emitFile: (file: EmittedAsset) => string;
  resolve: (source: string, importer?: string) => Promise<ResolvedId | null | undefined>;
  warn: (log: Log | string) => void;
}

// --- Hook results ---

export interface PartialResolvedId {
  id: string;
  external?: boolean | "absolute" | "relative" | undefined;
  meta?: Record<string, any> | null | undefined;
  moduleSideEffects?: boolean | "no-treeshake" | null | undefined;
  resolvedBy?: string | undefined;
}

export type ResolveIdResult = string | false | PartialResolvedId | null | undefined | void;

export type LoadResult = string | null | undefined | void;

export type TransformResult =
  | string
  | { code: string; map?: SourceMapInput | undefined }
  | null
  | undefined
  | void;

export type RenderChunkResult =
  | string
  | { code: string; map?: SourceMapInput | undefined }
  | null
  | undefined
  | void;

export interface RenderedChunk {
  fileName: string;
  moduleIds: string[];
  imports: string[];
}

// --- Plugin ---

export interface UnwasmPlugin {
  name: string;

  resolveId: {
    order: "pre";
    filter: { id: StringFilter<RegExp> };
    handler: (
      this: PluginContext,
      id: string,
      importer: string | undefined,
    ) => Awaitable<ResolveIdResult>;
  };

  load: {
    order: "pre";
    filter: { id: StringFilter };
    handler: (this: PluginContext, id: string) => Awaitable<LoadResult>;
  };

  transform: {
    order: "pre";
    filter: { id: StringFilter };
    handler: (this: PluginContext, code: string, id: string) => Awaitable<TransformResult>;
  };

  generateBundle: (this: PluginContext) => void;

  renderChunk: (
    this: PluginContext,
    code: string,
    chunk: RenderedChunk,
  ) => Awaitable<RenderChunkResult>;
}
