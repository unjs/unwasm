// @ts-ignore
import { decode as _parseWasm } from "@webassemblyjs/wasm-parser";

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
  type: "Func" | "Memory";
};

export type ParseResult = {
  modules: ParsedWasmModule[];
};

export function parseWasm(source: Buffer | ArrayBuffer): ParseResult {
  const ast = _parseWasm(source) as any;

  const modules = [];

  for (const body of ast.body) {
    if (body.type === "Module") {
      const module: ParsedWasmModule = {
        imports: [],
        exports: [],
      };
      modules.push(module);
      for (const field of body.fields) {
        if (field.type === "ModuleImport") {
          module.imports.push({
            module: field.module,
            name: field.name,
            returnType: field.descr?.signature?.results?.[0],
            params: field.descr.signature.params?.map(
              (p: { id?: string; valtype: string }) => ({
                id: p.id,
                type: p.valtype,
              }),
            ),
          });
        } else if (field.type === "ModuleExport") {
          module.exports.push({
            name: field.name,
            id: field.descr.id.value,
            type: field.descr.exportType,
          });
        }
      }
    }
  }

  return {
    modules,
  };
}
