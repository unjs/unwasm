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
async function buildFixture(name: string, deps: string) {
  const dir = `${TMP}/${name}`;
  await mkdir(dir, { recursive: true });

  const module = wabt.parseWat("mod.wat", WAT);
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
    plugins: [rollupNodeResolve({}), unwasm({})],
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
});
