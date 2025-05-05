import fs from "node:fs";
import tmp from "tmp";
import which from "which";
import { execSync } from "node:child_process";
import { UnwasmPluginOptions } from "../shared";

export function treeshake(
  source: Buffer,
  exports: string[],
  opts: UnwasmPluginOptions,
): Buffer {
  const wasmMetaDcePath = opts.wasmMetaDCE ?? which.sync("wasm-metadce");
  // Create the wasm-metadce graph.
  const graph = [
    {
      name: "outside",
      reaches: [...exports],
      root: true,
    },
  ];
  for (const exportName of exports) {
    graph.push({
      name: exportName,
      export: exportName,
    });
  }
  let output;
  const graphFile = tmp.fileSync({ postfix: ".json" });
  const wasmFile = tmp.fileSync({ postfix: ".wasm" });
  const outputFile = tmp.fileSync({ postfix: ".wasm" });
  try {
    fs.writeFileSync(graphFile.name, JSON.stringify(graph));
    fs.writeFileSync(wasmFile.name, source);
    execSync(
      `${wasmMetaDcePath} ${wasmFile.name} --graph-file ${graphFile.name} -o ${outputFile.name}`,
    );
    output = fs.readFileSync(outputFile.name);
  } finally {
    graphFile.removeCallback();
    wasmFile.removeCallback();
    outputFile.removeCallback();
  }
  return output;
}

/**
 * Removes elements from one array that are present in another array.
 *
 * @param exports - The array of strings to filter.
 * @param removedExports - The array of strings to remove from the exports array.
 * @returns A new array containing elements from exports with removedExports removed.
 */
export function filterExports(exports: string[], removedExports: string[]) {
  // Create a Set from removedExports for efficient lookup.
  const removedExportsSet = new Set(removedExports);
  const filteredExports = exports.filter((exportItem) => {
    // Keep the item if it's NOT in the removedExportsSet.
    return !removedExportsSet.has(exportItem);
  });

  return filteredExports;
}
