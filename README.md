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

- [ ] Universal builder plugins built with [unjs/unplugin](https://github.com/unjs/unplugin) ([unjs/unwasm#2](https://github.com/unjs/unwasm/issues/2))
  - [x] Rollup
- [ ] Tools to operate and inspect `.wasm` files ([unjs/unwasm#3](https://github.com/unjs/unwasm/issues/3))
- [ ] Runtime utils ([unjs/unwasm#4](https://github.com/unjs/unwasm/issues/4))
- [ ] ESM loader for Node.js and other JavaScript runtimes ([unjs/unwasm#5](https://github.com/unjs/unwasm/issues/5))
- [ ] Integration with [Wasmer](https://github.com/wasmerio) ([unjs/unwasm#6](https://github.com/unjs/unwasm/issues/6))
- [ ] Convention and tools for library authors exporting wasm modules ([unjs/unwasm#7](https://github.com/unjs/unwasm/issues/7))

## Bindings API

When importing a `.wasm` module using unwasm, it will take steps to transform the binary and finally resolve to an ESM module that allows you to interact with the WASM module. The returned result is a [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) object. This proxy allows to use of an elegant API while also having both backward and forward compatibility with WASM modules as the ecosystem evolves.

WebAssembly modules that don't require any imports, can be imported simply like you import any other ESM module:

**Using static import:**

```js
import { func } from "lib/module.wasm";
```

**Using dynamic import:**

```js
const { func } = await import("lib/module.wasm").then((mod) => mod.default);
```

In case your WebAssembly module requires an import object (which is likely!), the usage syntax would be slightly different as we need to initial the module with an import object first:

**Using static import with imports object:**

```js
import { func, $init } from "lib/module.wasm";

await $init({ env: {} });
```

**Using dynamic import with imports object:**

```js
const { func } = await import("lib/module.wasm").then((mod) => mod.$init(env));
```

> [!NOTE] > **When using static import syntax**, and before calling `$init`, the named exports will be wrapped into a function by proxy that waits for the module initialization and before that, if called, will immediately try to call `$init()` and return a Promise that calls a function after init.

> [!NOTE]
> Named exports with the `$` prefix are reserved for unwasm. In case your module uses them, you can access them from the `$exports` property.

## Usage

Unwasm needs to transform the `.wasm` imports to the compatible bindings. Currently only method is using a rollup plugin. In the future, more usage methods will be introduced.

### Install

First, install the [`unwasm` npm package](https://www.npmjs.com/package/unwasm):

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
import unwasmPlugin from "unwasm/plugin";

export default {
  plugins: [
    unwasmPlugin.rollup({
      /* options */
    }),
  ],
};
```

### Plugin Options

- `esmImport`: Direct import the wasm file instead of bundling, required in Cloudflare Workers (default is `false`)
- `lazy`: Import `.wasm` files using a lazily evaluated promise for compatibility with runtimes without top-level await support (default is `false`)

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
