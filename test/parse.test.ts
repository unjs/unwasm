import { fileURLToPath } from "node:url";
import { readdir, readFile, rm } from "node:fs/promises";
import { it, describe, expect } from "vitest";
import { resolveModulePath } from "exsolve";
import { parseWasm } from "../src/tools";
import { dirname, join } from "node:path";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

await rm(r(".tmp"), { recursive: true }).catch(() => {});

describe("parseWasm", () => {
  it("random.wasm", async () => {
    const source = await readFile(r("../examples/rand.wasm"));

    const parsed = parseWasm(source);
    expect(parsed).toMatchInlineSnapshot(`
      {
        "modules": [
          {
            "exports": [
              {
                "id": 5,
                "name": "rand",
                "type": "Func",
              },
              {
                "id": 0,
                "name": "memory",
                "type": "Memory",
              },
            ],
            "imports": [
              {
                "module": "env",
                "name": "seed",
                "params": [],
                "returnType": "f64",
              },
            ],
          },
        ],
      }
    `);
  });

  // Tests are only manual as takes ~5sec per wasm
  describe.skip("dep: @prisma/client", { concurrent: true }, async () => {
    const prismaRuntime = dirname(
      resolveModulePath("@prisma/client/runtime/library", {
        from: import.meta.url,
      }),
    );
    const prismaWasmFiles = await readdir(prismaRuntime).then((r) =>
      r.filter((f) => f.endsWith(".wasm")),
    );

    for (const file of prismaWasmFiles) {
      it(
        `should parse ${file}`,
        { timeout: 60_000, concurrent: true },
        async () => {
          const source = await readFile(join(prismaRuntime, file));
          const parsed = parseWasm(source);
          console.log(parsed);
        },
      );
    }
  });
});
