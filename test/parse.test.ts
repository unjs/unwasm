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
});
