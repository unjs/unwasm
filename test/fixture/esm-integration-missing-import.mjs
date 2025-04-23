import { badImportName } from "@fixture/wasm/add-esmi.wasm";

export function test() {
  if (badImportName(1) !== 42) {
    return "FALED: sum";
  }
  return "OK";
}
