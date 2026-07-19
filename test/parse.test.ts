import { fileURLToPath } from "node:url";
import { readFile, rm } from "node:fs/promises";
import { it, describe, expect } from "vitest";
import wabtInit from "wabt";
import { parseWasm } from "../src/tools";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

await rm(r(".tmp"), { recursive: true }).catch(() => {});

const wabt = await wabtInit();

/** Compile inline `.wat` source so fixtures stay readable. */
function compile(wat: string, opts: { debugNames?: boolean } = {}) {
  const module = wabt.parseWat("test.wat", wat, {
    multi_value: true,
    simd: true,
    reference_types: true,
    bulk_memory: true,
  });
  try {
    return Buffer.from(
      module.toBinary({ write_debug_names: opts.debugNames ?? false }).buffer,
    );
  } finally {
    module.destroy();
  }
}

const parseWat = (wat: string, opts?: { debugNames?: boolean }) =>
  parseWasm(compile(wat, opts)).modules[0];

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

  it("sum.wasm", async () => {
    const source = await readFile(r("../examples/sum.wasm"));

    expect(parseWasm(source)).toMatchInlineSnapshot(`
      {
        "modules": [
          {
            "exports": [
              {
                "id": 0,
                "name": "sum",
                "type": "Func",
              },
              {
                "id": 0,
                "name": "memory",
                "type": "Memory",
              },
            ],
            "imports": [],
          },
        ],
      }
    `);
  });

  it("add-esmi.wasm", async () => {
    const source = await readFile(r("../examples/add-esmi.wasm"));

    expect(parseWasm(source)).toMatchInlineSnapshot(`
      {
        "modules": [
          {
            "exports": [
              {
                "id": 1,
                "name": "addImported",
                "type": "Func",
              },
            ],
            "imports": [
              {
                "module": "./add-esmi-deps.mjs",
                "name": "getValue",
                "params": [],
                "returnType": "i32",
              },
            ],
          },
        ],
      }
    `);
  });

  it("accepts ArrayBuffer and Uint8Array", async () => {
    const buffer = await readFile(r("../examples/sum.wasm"));
    const expected = parseWasm(buffer);

    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
    expect(parseWasm(arrayBuffer)).toEqual(expected);
    expect(parseWasm(new Uint8Array(arrayBuffer))).toEqual(expected);
  });

  it("parses an empty module", () => {
    expect(parseWat(`(module)`)).toEqual({ imports: [], exports: [] });
  });

  it("parses import signatures", () => {
    const { imports } = parseWat(`(module
      (import "env" "noop" (func))
      (import "env" "add" (func (param i32 i64) (result f32)))
      (import "other" "wide" (func (param v128 externref funcref) (result f64)))
    )`);

    expect(imports).toEqual([
      { module: "env", name: "noop", returnType: undefined, params: [] },
      {
        module: "env",
        name: "add",
        returnType: "f32",
        params: [{ type: "i32" }, { type: "i64" }],
      },
      {
        module: "other",
        name: "wide",
        returnType: "f64",
        params: [{ type: "v128" }, { type: "externref" }, { type: "funcref" }],
      },
    ]);
  });

  it("reports the first result of a multi-value signature", () => {
    const { imports } = parseWat(`(module
      (import "env" "pair" (func (result i32 f64)))
    )`);

    expect(imports[0].returnType).toBe("i32");
  });

  it("parses non-function imports without losing later entries", () => {
    // Memory/global/table descriptors must be skipped precisely, otherwise
    // every import after them is misread.
    const { imports } = parseWat(`(module
      (import "env" "mem" (memory 1))
      (import "env" "tbl" (table 1 funcref))
      (import "env" "glob" (global i32))
      (import "env" "globMut" (global (mut i64)))
      (import "env" "last" (func (param i32)))
    )`);

    expect(imports.map((i) => i.name)).toEqual([
      "mem",
      "tbl",
      "glob",
      "globMut",
      "last",
    ]);
    expect(imports.at(-1)).toEqual({
      module: "env",
      name: "last",
      returnType: undefined,
      params: [{ type: "i32" }],
    });
  });

  it("parses memory imports with an explicit maximum", () => {
    // `limits` is variable width: the max is only present when the flag is set.
    const { imports } = parseWat(`(module
      (import "env" "mem" (memory 1 4))
      (import "env" "last" (func))
    )`);

    expect(imports.map((i) => i.name)).toEqual(["mem", "last"]);
  });

  it("parses every export kind", () => {
    const { exports } = parseWat(`(module
      (func $f (result i32) (i32.const 1))
      (memory $m 1)
      (table $t 1 funcref)
      (global $g i32 (i32.const 0))
      (export "f" (func $f))
      (export "m" (memory $m))
      (export "t" (table $t))
      (export "g" (global $g))
    )`);

    expect(exports).toEqual([
      { name: "f", id: 0, type: "Func" },
      { name: "m", id: 0, type: "Memory" },
      { name: "t", id: 0, type: "Table" },
      { name: "g", id: 0, type: "Global" },
    ]);
  });

  it("offsets function indexes by imported functions", () => {
    const { exports } = parseWat(`(module
      (import "env" "seed" (func $seed (result i32)))
      (func $answer (result i32) (i32.const 42))
      (export "answer" (func $answer))
    )`);

    expect(exports).toEqual([{ name: "answer", id: 1, type: "Func" }]);
  });

  it("resolves export ids from the name section when present", () => {
    const wat = `(module
      (import "env" "seed" (func $seed (result i32)))
      (func $answer (result i32) (i32.const 42))
      (memory $mem 1)
      (export "answer" (func $answer))
      (export "memory" (memory $mem))
    )`;

    // The name section is optional; a stripped binary falls back to the index.
    expect(parseWat(wat, { debugNames: false }).exports).toEqual([
      { name: "answer", id: 1, type: "Func" },
      { name: "memory", id: 0, type: "Memory" },
    ]);

    expect(parseWat(wat, { debugNames: true }).exports).toEqual([
      { name: "answer", id: "answer", type: "Func" },
      { name: "memory", id: 0, type: "Memory" },
    ]);
  });

  it("preserves non-ascii names", () => {
    // wabt expects raw bytes in `.wat` literals, so the UTF-8 is escaped here.
    const { imports, exports } = parseWat(String.raw`(module
      (import "caf\c3\a9" "\cf\80" (func))
      (func $f)
      (export "\e6\97\a5\e6\9c\ac\e8\aa\9e" (func $f))
    )`);

    expect(imports[0]).toMatchObject({ module: "café", name: "π" });
    expect(exports[0].name).toBe("日本語");
  });

  it("skips sections it does not understand", () => {
    // Data/code/start/custom sections must be stepped over by length alone.
    const { exports } = parseWat(`(module
      (memory $m 1)
      (data (i32.const 0) "some data payload")
      (func $f (result i32) (i32.const 1))
      (func $f2)
      (start $f2)
      (export "f" (func $f))
    )`);

    expect(exports).toEqual([{ name: "f", id: 0, type: "Func" }]);
  });

  describe("errors", () => {
    it("rejects a non-wasm buffer", () => {
      expect(() => parseWasm(Buffer.from("not wasm at all"))).toThrow(
        /invalid magic header/,
      );
    });

    it("rejects an empty buffer", () => {
      expect(() => parseWasm(Buffer.alloc(0))).toThrow(/invalid magic header/);
    });

    it("rejects a truncated binary", () => {
      const source = compile(`(module
        (import "env" "seed" (func (result i32)))
        (func $f (result i32) (i32.const 1))
        (export "f" (func $f))
      )`);

      expect(() => parseWasm(source.subarray(0, -5))).toThrow(
        /exceeds the end of the binary/,
      );
    });

    it("includes the module name and preserves the cause", () => {
      let error: any;
      try {
        parseWasm(Buffer.from("nope"), { name: "my-module.wasm" });
      } catch (error_) {
        error = error_;
      }

      expect(error.message).toMatch(
        /\[unwasm\] Failed to parse my-module\.wasm/,
      );
      expect(error.cause).toBeInstanceOf(Error);
    });
  });
});
