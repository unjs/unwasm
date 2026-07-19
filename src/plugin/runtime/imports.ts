import { readFile } from "node:fs/promises";
import { resolveModulePath } from "exsolve";
import { dirname, join } from "node:path";

import { WasmAsset, UnwasmPluginOptions, UMWASM_HELPERS_ID } from "../shared";
import type { ExternalKind } from "../../tools";

interface PackageJSON {
  imports?: Record<string, string | Record<string, string>>;
}

export async function getWasmImports(asset: WasmAsset, _opts: UnwasmPluginOptions) {
  const importNames = Object.keys(asset.imports || {});
  if (importNames.length === 0) {
    return {
      code: "const _imports = { /* no imports */ }",
      check: "",
      resolved: true,
    };
  }

  // Try to resolve from nearest package.json
  const pkg = await readNearestPackageJSON(asset.id);

  const resolved = true;

  const imports: string[] = [];
  const importsObject: Record<string, Record<string, string>> = {};
  // `[module, name, kind, valueType?]` entries, checked against the values the
  // JS modules actually export before the module is instantiated.
  const expected: ([string, string, ExternalKind] | [string, string, ExternalKind, string])[] = [];

  for (const moduleName of importNames) {
    const moduleImports = asset.imports[moduleName];

    // TODO: handle importAlias as object (https://nodejs.org/api/packages.html#imports)
    const importAlias = pkg.imports?.[moduleName] || pkg.imports?.[`#${moduleName}`];
    const resolved =
      importAlias && typeof importAlias === "string"
        ? importAlias
        : resolveModulePath(moduleName, { from: asset.id });

    const importName = "_imports_" + safeVariableName(moduleName);
    imports.push(`import * as ${importName} from ${JSON.stringify(resolved)};`);
    importsObject[moduleName] = Object.fromEntries(
      moduleImports.map(({ name }) => [name, `${importName}[${JSON.stringify(name)}]`]),
    );
    for (const { name, type, valueType } of moduleImports) {
      expected.push(valueType ? [moduleName, name, type, valueType] : [moduleName, name, type]);
    }
  }

  const code = [
    `import { checkImports } from "${UMWASM_HELPERS_ID}";`,
    imports.join("\n"),
    "",
    `const _imports = ${genObject(importsObject)}`,
    "",
    `const _expectedImports = ${JSON.stringify(expected)};`,
  ].join("\n");

  return {
    code,
    check: `checkImports(imports, _expectedImports, ${JSON.stringify(asset.name)});`,
    resolved,
  };
}

// Turn an arbitrary module name into a valid identifier fragment.
function safeVariableName(name: string): string {
  return name.replace(/^\d/, (r) => `_${r}`).replace(/\W/g, (r) => "_" + r.codePointAt(0));
}

// Generate an object literal from raw (already generated) value expressions.
function genObject(object: Record<string, string | Record<string, string>>, indent = ""): string {
  const entries = Object.entries(object);
  if (entries.length === 0) {
    return "{}";
  }
  const childIndent = indent + "  ";
  const lines = entries.map(
    ([key, value]) =>
      `${childIndent}${JSON.stringify(key)}: ${
        typeof value === "string" ? value : genObject(value, childIndent)
      }`,
  );
  return `{\n${lines.join(",\n")}\n${indent}}`;
}

// Read the nearest `package.json` by walking up from `from`.
// Returns an empty object if none is found.
async function readNearestPackageJSON(from: string): Promise<PackageJSON> {
  let dir = dirname(from);
  let lastDir = "";
  while (dir !== lastDir) {
    const contents = await readFile(join(dir, "package.json"), "utf8").catch(() => undefined);
    if (contents !== undefined) {
      return JSON.parse(contents) as PackageJSON;
    }
    lastDir = dir;
    dir = dirname(dir);
  }
  return {};
}
