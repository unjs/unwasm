export const imports = {
  env: {
    // eslint-disable-next-line unicorn/consistent-function-scoping
    seed: () => () => Math.random() * Date.now(),
  },
};
