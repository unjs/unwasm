# unwasm

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![Codecov][codecov-src]][codecov-href]

Univeral [WebAssembly](https://webassembly.org/) tools for JavaScript.

>[!IMPORTANT]
> This Project is under development!

## Goal

This project aims to make common and future-proof solution for WebAssembly modules support suitable for various JavaScript runtimes, Frameworks and build Tools following [WebAssembly/ES Module Integration](https://github.com/WebAssembly/esm-integration/tree/main/proposals/esm-integration) proposal from WebAssembly Community Group as much as possible.

## Roadmap

The development of this project will be splited into multiple stages.

- [ ] Plugin for bundlers using [unjs/unplugin](https://github.com/unjs/unplugin)
- [ ] Tools to operate and inspect `.wasm` files
- [ ] Runtime utils
- [ ] ESM loader for Node.js and other JavaScript runtimes
- [ ] Integration with [Wasmer](https://github.com/wasmerio)

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

Import:

```js
// ESM
import {} from "unwasm";

// CommonJS
const {} = await import("unwasm")
```


## Development

- Clone this repository
- Install latest LTS version of [Node.js](https://nodejs.org/en/)
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
[bundle-src]: https://img.shields.io/bundlephobia/minzip/unwasm?style=flat&colorA=18181B&colorB=F0DB4F
[bundle-href]: https://bundlephobia.com/result?p=unwasm
