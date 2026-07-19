export type ParsedWasmModule = {
  id?: string;
  imports: ModuleImport[];
  exports: ModuleExport[];
};

export type ModuleImport = {
  module: string;
  name: string;
  returnType?: string;
  params?: { id?: string; type: string }[];
};

export type ModuleExport = {
  name: string;
  id: string | number;
  type: ExternalKind;
};

export type ExternalKind = "Func" | "Table" | "Memory" | "Global";

export type ParseResult = {
  modules: ParsedWasmModule[];
};

const EXTERNAL_KINDS: ExternalKind[] = ["Func", "Table", "Memory", "Global"];

const VALTYPES: Record<number, string> = {
  0x7f: "i32",
  0x7e: "i64",
  0x7d: "f32",
  0x7c: "f64",
  0x7b: "v128",
  0x70: "funcref",
  0x6f: "externref",
};

const SECTION_TYPE = 1;
const SECTION_IMPORT = 2;
const SECTION_EXPORT = 7;
const SECTION_CUSTOM = 0;

const FUNCTYPE_FORM = 0x60;

const utf8Decoder = /* @__PURE__ */ new TextDecoder("utf-8", { fatal: true });

type FuncType = { params: string[]; results: string[] };

/**
 * Minimal WebAssembly binary reader.
 *
 * Only the sections needed to describe a module's interface are decoded. Every
 * section is length prefixed, so the rest (code, data, relocations, ...) is
 * skipped without being understood.
 */
class WasmReader {
  readonly bytes: Uint8Array;
  pos = 0;

  constructor(bytes: Uint8Array, pos = 0) {
    this.bytes = bytes;
    this.pos = pos;
  }

  get eof(): boolean {
    return this.pos >= this.bytes.length;
  }

  u8(): number {
    if (this.pos >= this.bytes.length) {
      throw new Error("unexpected end of binary");
    }
    return this.bytes[this.pos++];
  }

  /** LEB128 unsigned integer. */
  varuint(): number {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = this.u8();
      // Avoid `<<`: it wraps to a signed 32-bit result for large section sizes.
      result += (byte & 0x7f) * 2 ** shift;
      shift += 7;
      if (shift > 35) {
        throw new Error("varuint32 is too large");
      }
    } while (byte & 0x80);
    return result;
  }

  /** Length prefixed UTF-8 string. */
  name(): string {
    const length = this.varuint();
    const end = this.pos + length;
    if (end > this.bytes.length) {
      throw new Error("unexpected end of binary");
    }
    const value = utf8Decoder.decode(this.bytes.subarray(this.pos, end));
    this.pos = end;
    return value;
  }

  valtype(): string {
    const byte = this.u8();
    return VALTYPES[byte] || `unknown(0x${byte.toString(16)})`;
  }

  valtypes(): string[] {
    const length = this.varuint();
    const types: string[] = [];
    for (let i = 0; i < length; i++) {
      types.push(this.valtype());
    }
    return types;
  }

  /** `limits` as used by table and memory descriptors. */
  limits(): void {
    const flags = this.u8();
    this.varuint(); // min
    if (flags & 0x01) {
      this.varuint(); // max
    }
  }
}

type Section = { id: number; name?: string; start: number; end: number };

/** Split the binary into sections without decoding their contents. */
function readSections(reader: WasmReader): Section[] {
  const sections: Section[] = [];
  while (!reader.eof) {
    const id = reader.u8();
    const size = reader.varuint();
    const start = reader.pos;
    const end = start + size;
    if (end > reader.bytes.length) {
      throw new Error(`section ${id} exceeds the end of the binary`);
    }
    const section: Section = { id, start, end };
    if (id === SECTION_CUSTOM) {
      // The custom section's own name is part of its payload.
      section.name = reader.name();
      section.start = reader.pos;
    }
    sections.push(section);
    reader.pos = end;
  }
  return sections;
}

function readTypeSection(reader: WasmReader, end: number): FuncType[] {
  const types: FuncType[] = [];
  const length = reader.varuint();
  for (let i = 0; i < length; i++) {
    if (reader.pos >= end || reader.u8() !== FUNCTYPE_FORM) {
      // Not a plain function type (proposals add struct/array/rec forms).
      // Signatures for the remaining indexes stay unknown, names still parse.
      break;
    }
    types.push({ params: reader.valtypes(), results: reader.valtypes() });
  }
  return types;
}

function readImportSection(reader: WasmReader, types: FuncType[]) {
  const imports: ModuleImport[] = [];
  const length = reader.varuint();
  for (let i = 0; i < length; i++) {
    const module = reader.name();
    const name = reader.name();
    const kind = reader.u8();
    const entry: ModuleImport = { module, name };
    switch (kind) {
      case 0: {
        // func
        const type = types[reader.varuint()];
        entry.returnType = type?.results[0];
        entry.params = type?.params.map((type) => ({ type }));
        break;
      }
      case 1: {
        // table
        reader.u8(); // reftype
        reader.limits();
        break;
      }
      case 2: {
        // memory
        reader.limits();
        break;
      }
      case 3: {
        // global
        reader.u8(); // valtype
        reader.u8(); // mutability
        break;
      }
      default: {
        throw new Error(`unsupported import kind: ${kind}`);
      }
    }
    imports.push(entry);
  }
  return imports;
}

function readExportSection(reader: WasmReader) {
  const exports: (ModuleExport & { index: number })[] = [];
  const length = reader.varuint();
  for (let i = 0; i < length; i++) {
    const name = reader.name();
    const kind = reader.u8();
    const index = reader.varuint();
    exports.push({
      name,
      id: index,
      index,
      type: EXTERNAL_KINDS[kind] || "Func",
    });
  }
  return exports;
}

/**
 * Function names from the `name` custom section, when the binary was not
 * stripped. Used to give exported functions a symbolic id.
 */
function readFunctionNames(reader: WasmReader, end: number) {
  const names = new Map<number, string>();
  while (reader.pos < end) {
    const id = reader.u8();
    const size = reader.varuint();
    const subsectionEnd = reader.pos + size;
    if (id === 1) {
      // function names
      const length = reader.varuint();
      for (let i = 0; i < length; i++) {
        names.set(reader.varuint(), reader.name());
      }
    }
    reader.pos = subsectionEnd;
  }
  return names;
}

function toBytes(source: Uint8Array | ArrayBuffer): Uint8Array {
  return source instanceof Uint8Array ? source : new Uint8Array(source);
}

export function parseWasm(
  source: Buffer | ArrayBuffer | Uint8Array,
  opts: { name?: string } = {},
): ParseResult {
  try {
    return _parseWasm(toBytes(source));
  } catch (error) {
    throw new Error(
      `[unwasm] Failed to parse ${opts.name || "wasm module"}: ${error}`,
      { cause: error },
    );
  }
}

function _parseWasm(bytes: Uint8Array): ParseResult {
  // Magic ("\0asm") and version are the only fixed width header fields.
  if (
    bytes.length < 8 ||
    bytes[0] !== 0x00 ||
    bytes[1] !== 0x61 ||
    bytes[2] !== 0x73 ||
    bytes[3] !== 0x6d
  ) {
    throw new Error("invalid magic header (expected `\\0asm`)");
  }

  const sections = readSections(new WasmReader(bytes, 8));
  const at = (section: Section) => new WasmReader(bytes, section.start);
  const find = (id: number, name?: string) =>
    sections.find(
      (s) => s.id === id && (name === undefined || s.name === name),
    );

  const typeSection = find(SECTION_TYPE);
  const types = typeSection
    ? readTypeSection(at(typeSection), typeSection.end)
    : [];

  const importSection = find(SECTION_IMPORT);
  const imports = importSection
    ? readImportSection(at(importSection), types)
    : [];

  const exportSection = find(SECTION_EXPORT);
  const exports = exportSection ? readExportSection(at(exportSection)) : [];

  const nameSection = find(SECTION_CUSTOM, "name");
  if (nameSection && exports.length > 0) {
    const functionNames = readFunctionNames(at(nameSection), nameSection.end);
    for (const entry of exports) {
      if (entry.type === "Func") {
        entry.id = functionNames.get(entry.index) ?? entry.id;
      }
    }
  }

  return {
    modules: [
      {
        imports,
        exports: exports.map(({ name, id, type }) => ({ name, id, type })),
      },
    ],
  };
}
