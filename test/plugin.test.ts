import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { it, describe, expect } from "vitest";
import { evalModule } from "mlly";
import { nodeResolve as rollupNodeResolve } from "@rollup/plugin-node-resolve";
import { rollup } from "rollup";
import unwasm from "../src/plugin";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

await rm(r(".tmp"), { recursive: true }).catch(() => {});

describe("plugin:rollup-inline", () => {
  it("works", async () => {
    const build = await rollup({
      input: r("fixture/static-import.mjs"),
      plugins: [rollupNodeResolve({}), unwasm.rollup({})],
    });
    const { output } = await build.write({
      format: "esm",
      entryFileNames: "index.mjs",
      chunkFileNames: "[name].mjs",
      dir: r(".tmp/rollup-inline"),
    });
    const code = output[0].code;
    const mod = await evalModule(code, { url: r("fixture/static-import.mjs") });
    expect(mod.test()).toBe("OK");
  });
});

describe("plugin:rollup-esm", () => {
  it("works", async () => {
    const build = await rollup({
      input: r("fixture/dynamic-import.mjs"),
      plugins: [rollupNodeResolve({}), unwasm.rollup({ esmImport: true })],
    });
    const { output } = await build.write({
      format: "esm",
      entryFileNames: "index.mjs",
      chunkFileNames: "[name].mjs",
      dir: r(".tmp/rollup-esm"),
    });

    const code = (output[1] && "code" in output[1] && output[1].code) || "";
    const esmImport = code.match(/["'](.+wasm)["']/)?.[1];
    expect(esmImport).match(/\.\/wasm\/index-[\da-f]+\.wasm/);
    expect(existsSync(r(`.tmp/rollup-esm/${esmImport}`))).toBe(true);

    const { Miniflare } = await import("miniflare");
    const mf = new Miniflare({
      modules: true,
      modulesRules: [{ type: "CompiledWasm", include: ["**/*.wasm"] }],
      scriptPath: r(".tmp/rollup-esm/_mf.mjs"),
      script: `
  import { test } from "./index.mjs";
  export default {
    async fetch(request, env, ctx) {
      return new Response(test());
    }
  }
  `,
    });
    const res = await mf.dispatchFetch("http://localhost");
    const resText = await res.text();
    expect(resText).toBe("OK");
    await mf.dispose();
  });
});
