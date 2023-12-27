import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { it, describe, expect } from "vitest";
import { evalModule } from "mlly";
import { nodeResolve as rollupNodeResolve } from "@rollup/plugin-node-resolve";
import { rollup } from "rollup";
import unwasm from "../src/plugin";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const entry = r("fixture/index.mjs");

describe("plugin:rollup-inline", () => {
  it("builds", async () => {
    const build = await rollup({
      input: entry,
      plugins: [rollupNodeResolve({}), unwasm.rollup({})],
    });
    const { output } = await build.generate({ format: "esm" });
    const code = output[0].code;
    const mod = await evalModule(code, { url: entry });
    expect(mod.rand(1, 1000)).toBeGreaterThan(0);
  });
});

describe("plugin:rollup-esm", () => {
  it("builds", async () => {
    const build = await rollup({
      input: entry,
      plugins: [rollupNodeResolve({}), unwasm.rollup({ esmImport: true })],
    });
    const { output } = await build.write({
      format: "esm",
      dir: r(".tmp/rollup-esm"),
    });
    const code = output[0].code;
    const esmImport = code.match(/import\('(.+wasm)'\)/)?.[1];
    expect(esmImport).match(/\.\/wasm\/index-[\da-f]+\.wasm/);
    expect(existsSync(r(`.tmp/rollup-esm/${esmImport}`))).toBe(true);
    // TODO: Fix mlly to allow evaluating native .wasm
  });
});
