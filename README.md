[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![Codecov][codecov-src]][codecov-href]

# unwasm

Universal [WebAssembly](https://webassembly.org/) tools for JavaScript.

## Goal

This project aims to make a common and future-proof solution for WebAssembly modules support suitable for various JavaScript runtimes, frameworks, and build Tools following [WebAssembly/ES Module Integration](https://github.com/WebAssembly/esm-integration/tree/main/proposals/esm-integration) proposal from WebAssembly Community Group as much as possible while also trying to keep compatibility with current ecosystem libraries.

## Roadmap

The development will be split into multiple stages.

> [!IMPORTANT]
> This Project is under development! See the linked discussions to be involved!

- [ ] Builder plugin powered by [unjs/unplugin](https://github.com/unjs/unplugin) ([unjs/unwasm#2](https://github.com/unjs/unwasm/issues/2))
  - [x] Rollup
- [ ] Build Tools ([unjs/unwasm#3](https://github.com/unjs/unwasm/issues/3))
  - [x] `parseWasm`
- [ ] Runtime Utils ([unjs/unwasm#4](https://github.com/unjs/unwasm/issues/4))
- [ ] ESM Loader ([unjs/unwasm#5](https://github.com/unjs/unwasm/issues/5))
- [ ] Integration with [Wasmer](https://github.com/wasmerio) ([unjs/unwasm#6](https://github.com/unjs/unwasm/issues/6))
- [ ] Convention for library authors exporting wasm modules ([unjs/unwasm#7](https://github.com/unjs/unwasm/issues/7))
  - [x] Auto resolve imports from the imports map

## Bindings API

When importing a `.wasm` module, unwasm resolves, reads, and then parses the module during the build process to get the information about imports and exports and even tries to [automatically resolve imports](#auto-imports) and generate appropriate code bindings for the bundler.

If the target environment supports [top level `await`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await#top_level_await) and also the wasm module requires no imports object (or they are auto resolvable), unwasm generates bindings to allow importing wasm module like any other ESM import.

If the target environment lacks support for top-level `await` or the wasm module requires an imports object or `lazy` plugin option is set to `true`, unwasm will export a wrapped [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) object which can be called as a function to evaluate the module with custom imports object lazily. This way we still have a simple syntax as close as possible to ESM modules and also we can lazily initialize modules.

**Example:** Using static import

```js
import { sum } from "unwasm/examples/sum.wasm";
```

**Example:** Using dynamic import

```js
const { sum } = await import("unwasm/examples/sum.wasm");
```

If your WebAssembly module requires an import object (unwasm can [automatically infer them](#auto-imports)), the usage syntax would be slightly different as we need to initiate the module with an import object first.

**Example:** Using dynamic import with imports object

```js
const { rand } = await import("unwasm/examples/rand.wasm").then((r) =>
  r.default({
    env: {
      seed: () => () => Math.random() * Date.now(),
    },
  }),
);
```

**Example:** Using static import with imports object

```js
import initRand, { rand } from "unwasm/examples/rand.wasm";

await initRand({
  env: {
    seed: () => () => Math.random() * Date.now(),
  },
});
```

> [!NOTE]
> When using **static import syntax**, and before initializing the module, the named exports will be wrapped into a function by proxy that waits for the module initialization and if called before init, will immediately try to call init without imports and return a Promise that calls a function after init.

## Integration

Unwasm needs to transform the `.wasm` imports to the compatible bindings. Currently, the only method is using a rollup plugin. In the future, more usage methods will be introduced.

### Install

First, install the [`unwasm`](https://www.npmjs.com/package/unwasm) npm package.

```sh
# npm
npm install --dev unwasm

# yarn
yarn add -D unwasm

# pnpm
pnpm i -D unwasm

# bun
bun i -D unwasm
```

### Builder Plugins

###### Rollup

```js
// rollup.config.js
import { rollup as unwasm } from "unwasm/plugin";

export default {
  plugins: [
    unwasm({
      /* options */
    }),
  ],
};
```

### Plugin Options

- `esmImport`: Direct import the wasm file instead of bundling, required in Cloudflare Workers and works with environments that allow natively importing a `.wasm` module (default is `false`)
- `lazy`: Import `.wasm` files using a lazily evaluated proxy for compatibility with runtimes without top-level await support (default is `false`)

## Tools

unwasm provides useful build tools to operate on `.wasm` modules directly.

**Note:** `unwasm/tools` subpath export is **not** meant or optimized for production runtime. Only rely on it for development and build time.

### `parseWasm`

Parses `wasm` binary format with useful information using [webassemblyjs/wasm-parser](https://github.com/xtuc/webassemblyjs/tree/master/packages/wasm-parser).

```js
import { readFile } from "node:fs/promises";
import { parseWasm } from "unwasm/tools";

const source = await readFile(new URL("./examples/sum.wasm", import.meta.url));
const parsed = parseWasm(source);
console.log(JSON.stringify(parsed, undefined, 2));
```

Example parsed result:

```json
{
  "modules": [
    {
      "exports": [
        {
          "id": 5,
          "name": "rand",
          "type": "Func"
        },
        {
          "id": 0,
          "name": "memory",
          "type": "Memory"
        }
      ],
      "imports": [
        {
          "module": "env",
          "name": "seed",
          "params": [],
          "returnType": "f64"
        }
      ]
    }
  ]
}
```

## Auto Imports

unwasm can automatically infer the imports object and bundle them using imports maps (read more: [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap), [Node.js](https://nodejs.org/api/packages.html#imports) and [WICG](https://github.com/WICG/import-maps)).

To hint to the bundler how to resolve imports needed by the `.wasm` file, you need to define them in a parent `package.json` file.

**Example:**

```js
{
  "exports": {
    "./rand.wasm": "./rand.wasm"
  },
  "imports": {
    "env": "./env.mjs"
  }
}
```

**Note:** The imports can also be prefixed with `#` like `#env` if you like to respect Node.js conventions.

## Development

- Clone this repository
- Install the latest LTS version of [Node.js](https://nodejs.org/en/)
- Enable [Corepack](https://github.com/nodejs/corepack) using `corepack enable`
- Install dependencies using `pnpm install`
- Run interactive tests using `pnpm dev`
- Optionally install [es6-string-html](https://marketplace.visualstudio.com/items?itemName=Tobermory.es6-string-html) extension to make it easier to work with string templates.

## License

Made with 💛

Published under [MIT License](./LICENSE).

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/unwasm?style=flat&colorA=18181B&colorB=F0DB4F
[npm-version-href]: https://npmjs.com/package/unwasm
[npm-downloads-src]: https://img.shields.io/npm/dm/unwasm?style=flat&colorA=18181B&colorB=F0DB4F
[npm-downloads-href]: https://npmjs.com/package/unwasm
[codecov-src]: https://img.shields.io/codecov/c/gh/unjs/unwasm/main?style=flat&colorA=18181B&colorB=F0DB4F
[codecov-href]: https://codecov.io/gh/unjs/unwasm
