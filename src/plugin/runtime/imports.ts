// TODO: Use normal import in next major with ESM-only dist
// import { readPackageJSON } from "pkg-types";
import {
  genSafeVariableName,
  genObjectFromRaw,
  genString,
  genImport,
} from "knitwork";
import { resolveModulePath } from "exsolve";

import { WasmAsset, UnwasmPluginOptions } from "../shared";

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
  const { readPackageJSON } = await import("pkg-types");
  const pkg = await readPackageJSON(asset.id);

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
