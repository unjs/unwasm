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

export type ExternalKind = "Func" | "Table" | "Memory" | "Global" | "Tag";

export type ParseResult = {
  modules: ParsedWasmModule[];
};

const EXTERNAL_KINDS: ExternalKind[] = ["Func", "Table", "Memory", "Global", "Tag"];

const VALTYPES: Record<number, string> = {
  0x7f: "i32",
  0x7e: "i64",
  0x7d: "f32",
  0x7c: "f64",
  0x7b: "v128",
  0x70: "funcref",
  0x6f: "externref",
};

/**
 * `(ref null ht)` and `(ref ht)` from the typed function references / GC
 * proposals. These are two bytes wide, so consuming only the first one would
 * silently desync the reader and misreport every following name.
 */
const TYPED_REF_PREFIXES = new Set([0x63, 0x64]);

const SECTION_TYPE = 1;
const SECTION_IMPORT = 2;
const SECTION_EXPORT = 7;
const SECTION_CUSTOM = 0;

const FUNCTYPE_FORM = 0x60;

const utf8Decoder = /* @__PURE__ */ new TextDecoder("utf-8", {
  fatal: true,
  // A leading U+FEFF is a legal character in a wasm name, not a byte order
  // mark to be stripped.
  ignoreBOM: true,
});

type FuncType = { params: string[]; results: string[] };

/**
 * Minimal WebAssembly binary reader.
 *
 * Only the sections needed to describe a module's interface are decoded. Every
 * section is length prefixed, so the rest (code, data, relocations, ...) is
 * skipped without being understood.
 *
 * Anything this reader cannot model must raise rather than be guessed at: a
 * misparse silently reports the wrong import and export names, while an error
 * is reported by the caller and falls back to a plain `WebAssembly.Module`.
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

  /** LEB128 unsigned integer, limited to the 5 bytes a u32 can occupy. */
  varuint(): number {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (shift > 28) {
        throw new Error("varuint32 is too large");
      }
      byte = this.u8();
      // Avoid `<<`: it wraps to a signed 32-bit result for large section sizes.
      result += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    if (result > 0xff_ff_ff_ff) {
      throw new Error("varuint32 is too large");
    }
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

  /**
   * Unknown single byte types are tolerated (they are only reported as
   * metadata), but the multi byte typed reference forms are not, because
   * guessing their width would desync everything after them.
   */
  valtype(): string {
    const byte = this.u8();
    if (TYPED_REF_PREFIXES.has(byte)) {
      throw new Error(`unsupported typed reference (0x${byte.toString(16)})`);
    }
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

  /**
   * `limits` as used by table and memory descriptors. The flag bits select
   * shared (threads) and 64 bit (memory64) memories; only bit 0 adds a field.
   */
  limits(): void {
    const flags = this.u8();
    this.varuint(); // min
    if (flags & 0x01) {
      this.varuint(); // max
    }
  }

  /** Guard against a vector count that runs past its own section. */
  assertWithin(end: number): void {
    if (this.pos > end) {
      throw new Error("section contents overrun the section length");
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
      // The custom section's own name is part of its payload. A malformed one
      // leaves the section unidentified rather than failing the parse: custom
      // sections carry no semantics and must not invalidate the module.
      try {
        const name = reader.name();
        if (reader.pos <= end) {
          section.name = name;
          section.start = reader.pos;
        }
      } catch {
        // Unidentified, and therefore ignored below.
      }
    }
    sections.push(section);
    reader.pos = end;
  }
  return sections;
}

/**
 * Function signatures, used only to annotate imports. Types are best effort:
 * proposals keep adding forms (struct, array, rec, typed references) and a
 * missing signature is far less costly than a failed parse.
 */
function readTypeSection(reader: WasmReader, end: number): FuncType[] {
  const types: FuncType[] = [];
  try {
    const length = reader.varuint();
    for (let i = 0; i < length; i++) {
      if (reader.pos >= end || reader.u8() !== FUNCTYPE_FORM) {
        break;
      }
      const type = { params: reader.valtypes(), results: reader.valtypes() };
      reader.assertWithin(end);
      types.push(type);
    }
  } catch {
    // Signatures for the remaining indexes stay unknown, names still parse.
  }
  return types;
}

function readImportSection(reader: WasmReader, end: number, types: FuncType[]): ModuleImport[] {
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
        reader.valtype(); // reftype
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
        reader.valtype();
        reader.u8(); // mutability
        break;
      }
      case 4: {
        // tag
        reader.u8(); // attribute
        reader.varuint(); // typeidx
        break;
      }
      default: {
        throw new Error(`unsupported import kind: ${kind}`);
      }
    }
    reader.assertWithin(end);
    imports.push(entry);
  }
  return imports;
}

function readExportSection(reader: WasmReader, end: number) {
  const exports: (ModuleExport & { index: number })[] = [];
  const length = reader.varuint();
  for (let i = 0; i < length; i++) {
    const name = reader.name();
    const kind = reader.u8();
    const index = reader.varuint();
    const type = EXTERNAL_KINDS[kind];
    if (!type) {
      // Never guess: an unknown kind would take on the identity of whatever
      // entity happens to sit at this index.
      throw new Error(`unsupported export kind: ${kind}`);
    }
    reader.assertWithin(end);
    exports.push({ name, id: index, index, type });
  }
  return exports;
}

/**
 * Function names from the `name` custom section, when the binary was not
 * stripped. Used to give exported functions a symbolic id.
 *
 * Best effort, unlike the interface sections: this is a custom section, so a
 * malformed one must not invalidate a module the engine would accept. Names
 * that cannot be read simply leave their exports with a numeric id.
 */
function readFunctionNames(reader: WasmReader, end: number) {
  const names = new Map<number, string>();
  try {
    while (reader.pos < end) {
      const id = reader.u8();
      const size = reader.varuint();
      const subsectionEnd = reader.pos + size;
      if (subsectionEnd > end) {
        throw new Error("name subsection overruns the name section");
      }
      if (id === 1) {
        // function names
        const length = reader.varuint();
        for (let i = 0; i < length; i++) {
          const index = reader.varuint();
          names.set(index, reader.name());
          reader.assertWithin(subsectionEnd);
        }
      }
      reader.pos = subsectionEnd;
    }
  } catch {
    // Keep whatever was read before the section stopped making sense.
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
    throw new Error(`[unwasm] Failed to parse ${opts.name || "wasm module"}: ${error}`, {
      cause: error,
    });
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

  // Components share the magic but use a different layout, and would otherwise
  // decode as a core module with no imports or exports at all.
  if (bytes[4] !== 0x01 || bytes[5] !== 0x00 || bytes[6] !== 0x00 || bytes[7] !== 0x00) {
    const version = [...bytes.subarray(4, 8)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(" ");
    throw new Error(`unsupported binary version (0x${version})`);
  }

  const sections = readSections(new WasmReader(bytes, 8));
  const at = (section: Section) => new WasmReader(bytes, section.start);
  const find = (id: number, name?: string) =>
    sections.find((s) => s.id === id && (name === undefined || s.name === name));

  const typeSection = find(SECTION_TYPE);
  const types = typeSection ? readTypeSection(at(typeSection), typeSection.end) : [];

  const importSection = find(SECTION_IMPORT);
  const imports = importSection
    ? readImportSection(at(importSection), importSection.end, types)
    : [];

  const exportSection = find(SECTION_EXPORT);
  const exports = exportSection ? readExportSection(at(exportSection), exportSection.end) : [];

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
