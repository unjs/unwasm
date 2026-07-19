import { readFile } from "node:fs/promises";
import {
  genSafeVariableName,
  genObjectFromRaw,
  genString,
  genImport,
} from "knitwork";
import { resolveModulePath } from "exsolve";
import { dirname, join } from "pathe";

import { WasmAsset, UnwasmPluginOptions } from "../shared";

interface PackageJSON {
  imports?: Record<string, string | Record<string, string>>;
}

export async function getWasmImports(
  asset: WasmAsset,
  _opts: UnwasmPluginOptions,
) {
  const importNames = Object.keys(asset.imports || {});
  if (importNames.length === 0) {
    return {
      code: "const _imports = { /* no imports */ }",
      resolved: true,
    };
  }

  // Try to resolve from nearest package.json
  const pkg = await readNearestPackageJSON(asset.id);

  const resolved = true;

  const imports: string[] = [];
  const importsObject: Record<string, Record<string, string>> = {};

  for (const moduleName of importNames) {
    const importNames = asset.imports[moduleName];

    // TODO: handle importAlias as object (https://nodejs.org/api/packages.html#imports)
    const importAlias =
      pkg.imports?.[moduleName] || pkg.imports?.[`#${moduleName}`];
    const resolved =
      importAlias && typeof importAlias === "string"
        ? importAlias
        : resolveModulePath(moduleName, { from: asset.id });

    const importName = "_imports_" + genSafeVariableName(moduleName);
    imports.push(genImport(resolved, { name: "*", as: importName }));
    importsObject[moduleName] = Object.fromEntries(
      importNames.map((name) => [name, `${importName}[${genString(name)}]`]),
    );
  }

  const code = `${imports.join("\n")}\n\nconst _imports = ${genObjectFromRaw(importsObject)}`;

  return {
    code,
    resolved,
  };
}

// Read the nearest `package.json` by walking up from `from`.
// Returns an empty object if none is found.
async function readNearestPackageJSON(from: string): Promise<PackageJSON> {
  let dir = dirname(from);
  let lastDir = "";
  while (dir !== lastDir) {
    const contents = await readFile(join(dir, "package.json"), "utf8").catch(
      () => undefined,
    );
    if (contents !== undefined) {
      return JSON.parse(contents) as PackageJSON;
    }
    lastDir = dir;
    dir = dirname(dir);
  }
  return {};
}
