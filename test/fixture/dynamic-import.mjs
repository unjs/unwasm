const { sum } = await import("@fixture/wasm/examples/sum.wasm");

const { imports } = await import("./_shared.mjs");
const { rand } = await import("@fixture/wasm/examples/rand.wasm").then((r) =>
  r.default(imports),
);

export function test() {
  if (sum(1, 2) !== 3) {
    return "FALED: sum";
  }
  if (!(rand(0, 1000) > 0)) {
    return "FALED: rand";
  }
  return "OK";
}
