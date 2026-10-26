import { describe, expect, it } from "vitest";
import { unwasm, type UnwasmPluginOptions } from "../src/plugin";
import { parseWasm } from "../src/tools/parser";

const uleb128 = (value: number): number[] => {
  const bytes: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (value);
  return bytes;
};

const section = (id: number, contents: number[]) => [id, ...uleb128(contents.length), ...contents];
const name = (value: string) => [value.length, ...Buffer.from(value, "utf8")];

/**
 * A module the reader cannot decode, but which the engine accepts.
 *
 * The imported global is typed `(ref null func)`, a typed reference from the
 * function references proposal. Its `0x63` prefix is followed by a heap type
 * whose width the reader cannot know in general, so guessing it would desync
 * every import after it — the reader has to give up rather than guess.
 */
function unparsableWasm(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    // "\0asm", version 1
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    // import: "env" "g", global (ref null func), immutable
    ...section(2, [0x01, ...name("env"), ...name("g"), 0x03, 0x63, 0x70, 0x00]),
    // memory: one page, so the module has something to export
    ...section(5, [0x01, 0x00, 0x01]),
    // export: "m" (memory 0)
    ...section(7, [0x01, ...name("m"), 0x02, 0x00]),
  ]);
}

const ID = "/fixture/unparsable.wasm";

/** Drive the transform hook directly, capturing the warnings it emits. */
function createTransform(opts: UnwasmPluginOptions = {}) {
  const warnings: { message?: string }[] = [];
  const handler = unwasm(opts).transform.handler as unknown as (
    this: unknown,
    code: string,
    id: string,
  ) => Promise<{ code: string }>;
  const ctx = {
    warn(warning: { message?: string }) {
      warnings.push(warning);
    },
  };
  return {
    warnings,
    transform: (source: Uint8Array) =>
      handler.call(ctx, Buffer.from(source).toString("binary"), ID),
  };
}

/** Run the inlined base64 payload of a generated module binding. */
function compileGeneratedModule(code: string): WebAssembly.Module {
  const [, base64] = /base64ToUint8Array\("([^"]*)"\)/.exec(code) || [];
  expect(base64).toBeDefined();
  return new WebAssembly.Module(new Uint8Array(Buffer.from(base64, "base64")));
}

describe("unparsable binaries", () => {
  it("is a binary the engine accepts and the reader rejects", () => {
    // Both halves of the premise, so this stays a fallback test rather than
    // silently becoming a test about a binary nobody can load.
    const source = unparsableWasm();
    expect(WebAssembly.validate(source)).toBe(true);
    expect(WebAssembly.Module.imports(new WebAssembly.Module(source))).toEqual([
      { module: "env", name: "g", kind: "global" },
    ]);
    expect(() => parseWasm(source)).toThrow(/typed reference/);
  });

  it("falls back to module mode instead of binding to an empty interface", async () => {
    const { transform, warnings } = createTransform();
    const { code } = await transform(unparsableWasm());

    // Module mode hands the binary to the engine, which knows the types the
    // reader does not, so the generated binding still compiles.
    expect(code).toContain("new WebAssembly.Module");
    expect(code).toContain("export default _mod");
    expect(WebAssembly.Module.exports(compileGeneratedModule(code))).toEqual([
      { name: "m", kind: "memory" },
    ]);

    // The failing path: instantiating with an interface derived from a parse
    // that never succeeded. The module declares an import, so an empty
    // `_imports` throws at instantiation — at module scope, before the app
    // serves anything.
    expect(code).not.toContain("_instantiate");
    await expect(WebAssembly.instantiate(unparsableWasm(), {})).rejects.toThrow();

    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("module mode");
  });

  it("keeps falling back when the same asset is transformed again", async () => {
    // Parse results are cached per asset, so a second build of the same
    // binary must not read a cache entry that looks like a successful parse.
    const { transform } = createTransform();
    const source = unparsableWasm();

    const first = await transform(source);
    const second = await transform(source);

    expect(second.code).toBe(first.code);
    expect(second.code).toContain("new WebAssembly.Module");
  });

  it("stays silent when `silent` is set", async () => {
    const { transform, warnings } = createTransform({ silent: true });
    await transform(unparsableWasm());
    expect(warnings).toHaveLength(0);
  });
});
