import { describe, expect, it } from "vitest";
import { unwasm, type UnwasmPluginOptions } from "../src/plugin";

/**
 * A module the reader cannot decode, but which the engine may still accept.
 *
 * The import section declares one entry with kind `0x09`. Import kinds are
 * open ended (each proposal adds one), and the descriptor that follows is kind
 * specific, so an unknown kind leaves no way to find the next import — the
 * reader has to give up rather than guess.
 */
function unparsableWasm(): Buffer {
  const section = (id: number, contents: number[]) => [id, contents.length, ...contents];
  return Buffer.from([
    // "\0asm", version 1
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
    // type: [() -> ()]
    ...section(1, [0x01, 0x60, 0x00, 0x00]),
    // import: "env" "f", kind 0x09
    ...section(2, [0x01, 0x03, 0x65, 0x6e, 0x76, 0x01, 0x66, 0x09]),
    // export: "a" (func 0)
    ...section(7, [0x01, 0x01, 0x61, 0x00, 0x00]),
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
    transform: (source: Buffer) => handler.call(ctx, source.toString("binary"), ID),
  };
}

describe("unparsable binaries", () => {
  it("falls back to module mode instead of binding to an empty interface", async () => {
    const { transform, warnings } = createTransform();
    const { code } = await transform(unparsableWasm());

    // Module mode hands the binary to the engine, which knows the kinds the
    // reader does not.
    expect(code).toContain("new WebAssembly.Module");
    expect(code).toContain("export default _mod");

    // The failing path: instantiating with an interface derived from a parse
    // that never succeeded. The module declares an import, so an empty
    // `_imports` throws at instantiation — at module scope, before the app
    // serves anything.
    expect(code).not.toContain("no imports");
    expect(code).not.toContain("_instantiate");

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
