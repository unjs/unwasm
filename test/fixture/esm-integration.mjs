import { addImported } from "@fixture/wasm/add-esmi.wasm";

export function test() {
  if (addImported(1) !== 42) {
    return "FALED: sum";
  }
  return "OK";
}
