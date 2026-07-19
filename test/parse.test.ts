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
    threads: true,
    memory64: true,
    exceptions: true,
    multi_memory: true,
    tail_call: true,
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

const WASM_HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

/** Length prefixed UTF-8 string, as used for names in the binary format. */
const wasmName = (value: string) => {
  const bytes = [...Buffer.from(value, "utf8")];
  return [bytes.length, ...bytes];
};

const section = (id: number, body: number[]) => [id, body.length, ...body];

/**
 * Hand assembled binaries, for shapes wabt's `.wat` parser cannot express.
 */
const wasmBytes = (...sections: number[][]) =>
  Buffer.from([...WASM_HEADER, ...sections.flat()]);

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

  it("agrees with the engine's own view of the module", () => {
    // Cross checked against WebAssembly.Module rather than against a recorded
    // snapshot, so this can establish correctness and not just detect drift.
    const source = compile(`(module
      (import "env" "seed" (func $seed (result i32)))
      (import "env" "mem" (memory 1))
      (import "env" "glob" (global i32))
      (func $answer (result i32) (i32.const 42))
      (table $t 1 funcref)
      (global $g i32 (i32.const 0))
      (export "answer" (func $answer))
      (export "t" (table $t))
      (export "g" (global $g))
    )`);

    const module = new WebAssembly.Module(source);
    const { imports, exports } = parseWasm(source).modules[0];

    expect(imports.map((i) => `${i.module}.${i.name}`)).toEqual(
      WebAssembly.Module.imports(module).map((i) => `${i.module}.${i.name}`),
    );
    // Compared by kind as well, so the `ExternalKind` mapping is checked
    // against the engine rather than against our own expectations.
    expect(exports.map((e) => `${e.name}:${e.type.toLowerCase()}`)).toEqual(
      WebAssembly.Module.exports(module).map(
        (e) => `${e.name}:${e.kind === "function" ? "func" : e.kind}`,
      ),
    );
  });

  it("tolerates a malformed name section", () => {
    // Custom sections carry no semantics, so a broken `name` section must not
    // invalidate a module the engine accepts. The export falls back to its
    // numeric id rather than the parse failing.
    const bytes = wasmBytes(
      section(1, [0x01, 0x60, 0x00, 0x00]),
      section(3, [0x01, 0x00]),
      section(7, [0x01, ...wasmName("realExport"), 0x00, 0x00]),
      section(10, [0x01, 0x02, 0x00, 0x0b]),
      // Subsection 1 declares 0x7f bytes, far past the section end.
      section(0, [...wasmName("name"), 0x01, 0x7f, 0x01, 0x00]),
    );

    expect(() => new WebAssembly.Module(bytes)).not.toThrow();
    expect(parseWasm(bytes).modules[0].exports).toEqual([
      { name: "realExport", id: 0, type: "Func" },
    ]);
  });

  it("tolerates a custom section with an unreadable name", () => {
    const bytes = wasmBytes(
      section(1, [0x01, 0x60, 0x00, 0x00]),
      section(2, [0x01, ...wasmName("env"), ...wasmName("fn"), 0x00, 0x00]),
      // Declares a 0x7f byte name inside a 2 byte section.
      section(0, [0x7f, 0x00]),
    );

    expect(parseWasm(bytes).modules[0].imports).toMatchObject([
      { module: "env", name: "fn" },
    ]);
  });

  it("reports unknown value types without failing", () => {
    // An unrecognised single byte type is only metadata, so it is passed
    // through rather than rejected.
    const bytes = wasmBytes(
      section(1, [0x01, 0x60, 0x01, 0x5b, 0x00]),
      section(2, [0x01, ...wasmName("env"), ...wasmName("fn"), 0x00, 0x00]),
    );

    expect(parseWasm(bytes).modules[0].imports[0].params).toEqual([
      { type: "unknown(0x5b)" },
    ]);
  });

  describe("proposals", () => {
    it("parses shared memory imports (threads)", () => {
      // Flags 0x02/0x03 mark the memory shared; only bit 0 adds a maximum.
      const { imports } = parseWat(`(module
        (import "env" "shared" (memory 1 1 shared))
        (import "env" "last" (func))
      )`);

      expect(imports.map((i) => i.name)).toEqual(["shared", "last"]);
    });

    it("parses 64 bit memory imports (memory64)", () => {
      const { imports } = parseWat(`(module
        (import "env" "m64" (memory i64 1))
        (import "env" "m64max" (memory i64 1 2))
        (import "env" "last" (func))
      )`);

      expect(imports.map((i) => i.name)).toEqual(["m64", "m64max", "last"]);
    });

    it("parses tag imports and exports (exceptions)", () => {
      const { imports, exports } = parseWat(`(module
        (import "env" "thrown" (tag (param i32)))
        (func $realFunctionZero (result i32) (i32.const 7))
        (tag $myTag (param i32))
        (export "realFunctionZero" (func $realFunctionZero))
        (export "myTag" (tag $myTag))
      )`);

      expect(imports.map((i) => i.name)).toEqual(["thrown"]);
      // The imported tag takes tag index 0, so the defined one is index 1.
      expect(exports).toEqual([
        { name: "realFunctionZero", id: 0, type: "Func" },
        { name: "myTag", id: 1, type: "Tag" },
      ]);
    });

    it("keeps tag and function name resolution separate", () => {
      const { exports } = parseWat(
        `(module
          (func $realFunctionZero (result i32) (i32.const 7))
          (tag $myTag (param i32))
          (export "realFunctionZero" (func $realFunctionZero))
          (export "myTag" (tag $myTag))
        )`,
        { debugNames: true },
      );

      expect(exports).toEqual([
        { name: "realFunctionZero", id: "realFunctionZero", type: "Func" },
        { name: "myTag", id: 0, type: "Tag" },
      ]);
    });

    it("degrades gracefully on unknown type section forms", () => {
      // A GC struct type (0x5f) in the type section: signatures are lost, but
      // the import and export names must still be reported.
      const bytes = wasmBytes(
        section(1, [0x01, 0x5f, 0x00]),
        section(2, [0x01, ...wasmName("env"), ...wasmName("fn"), 0x00, 0x00]),
      );

      const { imports } = parseWasm(bytes).modules[0];
      expect(imports).toEqual([
        { module: "env", name: "fn", returnType: undefined, params: undefined },
      ]);
    });

    it("rejects typed reference imports instead of misreading them", () => {
      // `(ref null func)` is two bytes (0x63 0x70). Consuming only the first
      // would shift every following read and silently rename the imports.
      const table = wasmBytes(
        section(1, [0x01, 0x60, 0x00, 0x00]),
        section(2, [
          0x01,
          ...wasmName("env"),
          ...wasmName("tbl"),
          0x01,
          0x63,
          0x70,
          0x00,
          0x00,
        ]),
      );
      expect(() => parseWasm(table)).toThrow(/unsupported typed reference/);

      const global = wasmBytes(
        section(1, [0x01, 0x60, 0x00, 0x00]),
        section(2, [
          0x01,
          ...wasmName("env"),
          ...wasmName("glob"),
          0x03,
          0x64,
          0x70,
          0x00,
        ]),
      );
      expect(() => parseWasm(global)).toThrow(/unsupported typed reference/);
    });
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

    it("rejects a component instead of reporting it as empty", () => {
      // Components share the magic but use layer 1; decoding one as a core
      // module yields no imports or exports and no error at all.
      const component = Buffer.from([
        0x00, 0x61, 0x73, 0x6d, 0x0d, 0x00, 0x01, 0x00,
      ]);

      expect(() => parseWasm(component)).toThrow(
        /unsupported binary version \(0x0d 00 01 00\)/,
      );
    });

    it("rejects an export kind it cannot identify", () => {
      const bytes = wasmBytes(
        section(7, [0x01, ...wasmName("mystery"), 0x09, 0x00]),
      );

      expect(() => parseWasm(bytes)).toThrow(/unsupported export kind: 9/);
    });

    it("rejects a vector count that overruns its section", () => {
      // The section length is authoritative; a lying count must not read
      // entries out of the following section. The bytes after this export
      // section decode as a syntactically valid second entry (name "", kind 4,
      // index 3), so only the length check can reject it.
      const bytes = Buffer.from([
        ...WASM_HEADER,
        0x07,
        0x05,
        0x02,
        0x01,
        0x61,
        0x00,
        0x00, // export section, count lies
        0x00,
        0x04,
        0x03,
        0x61,
        0x62,
        0x63, // custom section "abc"
      ]);

      expect(() => parseWasm(bytes)).toThrow(
        /section contents overrun the section length/,
      );
    });

    it("preserves a leading U+FEFF in names", () => {
      // U+FEFF is a legal character in a wasm name, not a byte order mark.
      const bytes = wasmBytes(
        section(1, [0x01, 0x60, 0x00, 0x00]),
        section(2, [0x01, ...wasmName("﻿env"), ...wasmName("﻿fn"), 0x00, 0x00]),
      );

      const { imports } = parseWasm(bytes).modules[0];
      expect(imports[0]).toMatchObject({
        module: "﻿env",
        name: "﻿fn",
      });
    });

    it("rejects an overlong LEB128 integer", () => {
      // Six continuation bytes: more than a u32 can occupy.
      const bytes = wasmBytes([0x07, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]);

      expect(() => parseWasm(bytes)).toThrow(/varuint32 is too large/);
    });

    it("rejects a LEB128 integer that exceeds a u32", () => {
      // Five bytes, so within the length bound, but decodes to 2^32.
      const bytes = wasmBytes([0x07, 0x80, 0x80, 0x80, 0x80, 0x10]);

      expect(() => parseWasm(bytes)).toThrow(/varuint32 is too large/);
    });

    it("rejects an import kind it cannot identify", () => {
      const bytes = wasmBytes(
        section(2, [0x01, ...wasmName("env"), ...wasmName("fn"), 0x09]),
      );

      expect(() => parseWasm(bytes)).toThrow(/unsupported import kind: 9/);
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
