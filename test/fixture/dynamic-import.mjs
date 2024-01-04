const { sum } = await import("@fixture/wasm/sum.wasm");
const { rand } = await import("@fixture/wasm/rand.wasm").then((r) =>
  r.default(),
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
