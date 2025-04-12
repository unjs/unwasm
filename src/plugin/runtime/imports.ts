import { readPackageJSON } from "pkg-types";
import {
  genSafeVariableName,
  genObjectFromRaw,
  genString,
  genImport,
} from "knitwork";
import fs from "node:fs";
import path from "node:path";

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
  const pkgJSON = await readPackageJSON(asset.id);

  let resolved = true;

  const imports: string[] = [];
  const importsObject: Record<string, Record<string, string>> = {};

  const directory = path.dirname(asset.id);

  for (const moduleName of importNames) {
    const importNames = asset.imports[moduleName];
    let importFound = false;
    const pkgImport =
      pkgJSON.imports?.[moduleName] || pkgJSON.imports?.[`#${moduleName}`];

    const importName = "_imports_" + genSafeVariableName(moduleName);

    // TODO: haandle pkgImport as object
    if (pkgImport && typeof pkgImport === "string") {
      importFound = true;
      imports.push(genImport(pkgImport, { name: "*", as: importName }));
    } else if (fs.existsSync(path.resolve(directory, moduleName))) {
      importFound = true;
      imports.push(genImport(moduleName, { name: "*", as: importName }));
    } else {
      resolved = false;
    }

    importsObject[moduleName] = Object.fromEntries(
      importNames.map((name) => [
        name,
        importFound
          ? `${importName}[${genString(name)}]`
          : `() => { throw new Error(${genString(moduleName + "." + importName)} + " is not provided!")}`,
      ]),
    );
  }

  const code = `${imports.join("\n")}\n\nconst _imports = ${genObjectFromRaw(importsObject)}`;

  return {
    code,
    resolved,
  };
}
