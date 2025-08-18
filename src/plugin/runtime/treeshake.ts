import fs, { mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { UnwasmPluginOptions } from "../shared";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function treeshake(
  source: Buffer,
  exports: string[],
  opts: UnwasmPluginOptions,
): Buffer {
  // Create the wasm-metadce graph.
  const graph = [
    {
      name: "outside",
      root: true,
      reaches: [...exports],
    },
  ] as { name: string; root?: boolean; reaches?: string[]; export?: string }[];
  for (const exportName of exports) {
    graph.push({
      name: exportName,
      export: exportName,
    });
  }

  // Wasm Meta DCE binary
  const wasmMetaDCEBin = opts.commands?.wasmMetaDCE || "wasm-metadce";

  // Temporary files
  const tmpDir = join(
    tmpdir(),
    "unwasm-" + Math.random().toString(36).slice(2),
  );
  const graphFile = join(tmpDir, "graph.json");
  const wasmFile = join(tmpDir, "input.wasm");
  const outputFile = join(tmpDir, "output.wasm");
  mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(graphFile, JSON.stringify(graph));
  fs.writeFileSync(wasmFile, source);

  // Execute the wasm-metadce command
  try {
    execSync(
      `${wasmMetaDCEBin} ${wasmFile} --graph-file ${graphFile} -o ${outputFile}`,
      { stdio: "ignore" },
    );
    return fs.readFileSync(outputFile);
  } catch (error) {
    throw new Error(
      [
        error instanceof Error ? error.message : String(error),
        `Hint: Make sure "wasm-metadce" (part of binaryen) is installed and on your PATH,`,
        `or set commands.wasmMetaDCE option to the full path of the executable.`,
      ].join(" "),
      { cause: error },
    );
  } finally {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  }
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
