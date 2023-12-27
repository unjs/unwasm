# 🇼 unwasm

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![Codecov][codecov-src]][codecov-href]

Universal [WebAssembly](https://webassembly.org/) tools for JavaScript.

## Goal

This project aims to make a common and future-proof solution for WebAssembly modules support suitable for various JavaScript runtimes, Frameworks, and build Tools following [WebAssembly/ES Module Integration](https://github.com/WebAssembly/esm-integration/tree/main/proposals/esm-integration) proposal from WebAssembly Community Group as much as possible.

## Roadmap

The development will be split into multiple stages.

> [!IMPORTANT]
> This Project is under development! Join the linked discussions to be involved!

- [ ] Universal builder plugins ([unjs/unwasm#2](https://github.com/unjs/unwasm/issues/2)) built with [unjs/unplugin](https://github.com/unjs/unplugin) 
  - [x] Rollup
- [ ] Tools to operate and inspect `.wasm` files ([unjs/unwasm#3](https://github.com/unjs/unwasm/issues/3)) 
- [ ] Runtime utils ([unjs/unwasm#4](https://github.com/unjs/unwasm/issues/4)) 
- [ ] ESM loader for Node.js and other JavaScript runtimes ([unjs/unwasm#5](https://github.com/unjs/unwasm/issues/5))
- [ ] Integration with [Wasmer](https://github.com/wasmerio) ([unjs/unwasm#6](https://github.com/unjs/unwasm/issues/6)) 
- [ ] Convention and tools for library authors exporting wasm modules ([unjs/unwasm#7](https://github.com/unjs/unwasm/issues/7))

## Install

Install package from [npm](https://www.npmjs.com/package/unwasm):

```sh
# npm
npm install unwasm

# yarn
yarn add unwasm

# pnpm
pnpm install unwasm

# bun
bun install unwasm
```

## Using build plugin

###### Rollup

```js
import unwasmPlugin from "unwasm/plugin";

export default {
  plugins: [
    unwasmPlugin.rollup({
      /* options */
    }),
  ],
};
```

### Options

- `esmImport`: Direct import the wasm file instead of bundling, required in Cloudflare Workers (default is `false`)
- `lazy`: Import `.wasm` files using a lazily evaluated promise for compatibility with runtimes without top-level await support (default is `false`)

## Development

- Clone this repository
- Install the latest LTS version of [Node.js](https://nodejs.org/en/)
- Enable [Corepack](https://github.com/nodejs/corepack) using `corepack enable`
- Install dependencies using `pnpm install`
- Run interactive tests using `pnpm dev`

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
