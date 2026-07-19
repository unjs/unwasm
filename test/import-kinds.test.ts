import { fileURLToPath } from "node:url";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { it, describe, expect } from "vitest";
import wabtInit from "wabt";
import { evalModule } from "mlly";
import { nodeResolve as rollupNodeResolve } from "@rollup/plugin-node-resolve";
import { rollup } from "rollup";
import { unwasm } from "../src/plugin";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Not under `.tmp`: test files run in parallel and the plugin build suite
// clears that whole directory as it starts.
const TMP = r(".tmp-import-kinds");

await rm(TMP, { recursive: true }).catch(() => {});

const wabt = await wabtInit();

/**
 * A module that imports both a memory and a function from the same JS module.
 * Only the function can be satisfied by a plain JS value.
 */
const WAT = `(module
  (import "./deps.mjs" "sharedMem" (memory 1))
  (import "./deps.mjs" "getValue" (func $getValue (result i32)))
  (func (export "readValue") (result i32)
    call $getValue
  )
)`;

/** Write a self contained fixture package and bundle its entry. */
async function buildFixture(
  name: string,
  deps: string,
  opts: { wat?: string; lazy?: boolean } = {},
) {
  const dir = `${TMP}/${name}`;
  await mkdir(dir, { recursive: true });

  const module = wabt.parseWat("mod.wat", opts.wat ?? WAT, { reference_types: true });
  try {
    await writeFile(`${dir}/mod.wasm`, Buffer.from(module.toBinary({}).buffer));
  } finally {
    module.destroy();
  }

  await writeFile(`${dir}/deps.mjs`, deps);
  await writeFile(`${dir}/package.json`, `{ "type": "module" }`);
  await writeFile(`${dir}/index.mjs`, `export { readValue } from "./mod.wasm";`);

  const build = await rollup({
    input: `${dir}/index.mjs`,
    plugins: [rollupNodeResolve({}), unwasm({ lazy: opts.lazy })],
  });
  const { output } = await build.generate({ format: "esm" });
  return { code: output[0].code, url: `${dir}/index.mjs` };
}

describe("non-function imports", () => {
  it("instantiates when the JS module exports the right WebAssembly objects", async () => {
    const { code, url } = await buildFixture(
      "valid",
      `export const sharedMem = new WebAssembly.Memory({ initial: 1 });
       export const getValue = () => 42;`,
    );

    const mod = await evalModule(code, { url });
    expect(mod.readValue()).toBe(42);
  });

  it("names the import and the expected type instead of throwing a LinkError", async () => {
    // An ArrayBuffer is the mistake this guard exists for: the engine's own
    // LinkError names neither the JS module it came from nor what was needed.
    const { code, url } = await buildFixture(
      "wrong-type",
      `export const sharedMem = new ArrayBuffer(65536);
       export const getValue = () => 42;`,
    );

    await expect(evalModule(code, { url })).rejects.toThrow(
      /Invalid import `\.\/deps\.mjs` -> `sharedMem`.+expected a WebAssembly\.Memory, got ArrayBuffer/,
    );
  });

  it("reports an import the JS module does not export at all", async () => {
    const { code, url } = await buildFixture("missing", `export const getValue = () => 42;`);

    await expect(evalModule(code, { url })).rejects.toThrow(
      /`sharedMem`.+got undefined \(the module exports no such name\)/,
    );
  });

  it("rejects lazily rather than throwing out of the caller", async () => {
    const { code, url } = await buildFixture(
      "lazy",
      `export const sharedMem = new ArrayBuffer(65536);
       export const getValue = () => 42;`,
      { lazy: true },
    );

    // In lazy mode nothing is instantiated until a call, and that call must
    // return a rejected promise: `.catch()` has to be reachable.
    const mod = await evalModule(code, { url });
    await expect(mod.readValue()).rejects.toThrow(/expected a WebAssembly\.Memory/);
  });

  it("still rejects a function import that is not callable", async () => {
    const { code, url } = await buildFixture(
      "not-a-function",
      `export const sharedMem = new WebAssembly.Memory({ initial: 1 });
       export const getValue = 42;`,
    );

    await expect(evalModule(code, { url })).rejects.toThrow(
      /`getValue`.+expected a function, got Number/,
    );
  });

  // The guard must never reject what the engine would have accepted: a false
  // positive breaks a build that works today.
  describe("values the engine accepts", () => {
    it("accepts any JS value for a reference typed global", async () => {
      // `externref` globals take arbitrary values, so a numeric check would
      // reject a perfectly valid import.
      const { code, url } = await buildFixture(
        "externref-global",
        `export const cfg = { hello: "world" };
         export const count = 7;
         export const getValue = () => 42;
         export const sharedMem = new WebAssembly.Memory({ initial: 1 });`,
        {
          wat: `(module
            (import "./deps.mjs" "sharedMem" (memory 1))
            (import "./deps.mjs" "cfg" (global externref))
            (import "./deps.mjs" "count" (global i32))
            (import "./deps.mjs" "getValue" (func $getValue (result i32)))
            (func (export "readValue") (result i32)
              call $getValue
            )
          )`,
        },
      );

      const mod = await evalModule(code, { url });
      expect(mod.readValue()).toBe(42);
    });

    it("accepts a WebAssembly object from another realm", async () => {
      // The engine tests for an internal slot, which `instanceof` cannot see
      // across realms. Memories from a vm context, worker or iframe are valid.
      const { code, url } = await buildFixture(
        "cross-realm",
        `import { runInNewContext } from "node:vm";
         export const sharedMem = runInNewContext("new WebAssembly.Memory({ initial: 1 })");
         export const getValue = () => 42;`,
      );

      const mod = await evalModule(code, { url });
      expect(mod.readValue()).toBe(42);
    });
  });
});
