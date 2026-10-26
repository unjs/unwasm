# unwasm

<!-- automd:badges color=yellow codecov -->

[![npm version](https://img.shields.io/npm/v/unwasm?color=yellow)](https://npmjs.com/package/unwasm)
[![npm downloads](https://img.shields.io/npm/dm/unwasm?color=yellow)](https://npm.chart.dev/unwasm)
[![codecov](https://img.shields.io/codecov/c/gh/unjs/unwasm?color=yellow)](https://codecov.io/gh/unjs/unwasm)

<!-- /automd -->

Universal [WebAssembly](https://webassembly.org/) tools for JavaScript.

unwasm lets you `import` a `.wasm` file the same way you import any other module. It reads the module at build time, works out what it imports and exports, and generates the right bindings for your bundler.

```js
import { sum } from "sum.wasm";
```

## Goal

unwasm aims to be a common, future-proof way to support WebAssembly modules across JavaScript runtimes, frameworks, and build tools. It follows the WebAssembly Community Group's [ES Module Integration](https://github.com/WebAssembly/esm-integration/tree/main/proposals/esm-integration) proposal as closely as possible, while staying compatible with today's ecosystem libraries.

## Bindings API

When you import a `.wasm` module, unwasm resolves, reads, and parses it during the build to discover its imports and exports. It also tries to [resolve imports automatically](#auto-imports) and emits bindings tailored to your bundler.

The shape of those bindings depends on your target environment:

- **Static bindings** — if the environment supports [top-level `await`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await#top_level_await) and the module needs no imports object (or unwasm can resolve one for you), the `.wasm` file behaves like a regular ESM import.
- **Lazy bindings** — if top-level `await` is unavailable, the module needs an imports object, or you set the `lazy` plugin option, unwasm exports a [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) that you call as a function to instantiate the module with your own imports. The syntax stays close to ESM, and initialization happens only when you need it.

**Example:** Using static import

```js
import { sum } from "sum.wasm";
```

**Example:** Using dynamic import

```js
const { sum } = await import("sum.wasm");
```

If your module requires an imports object (which unwasm can often [infer for you](#auto-imports)), the syntax changes slightly: you initialize the module with that object first.

**Example:** Using dynamic import with imports object

```js
const { rand } = await import("rand.wasm").then((r) =>
  r.default({
    env: {
      seed: () => () => Math.random() * Date.now(),
    },
  }),
);
```

**Example:** Using static import with imports object

```js
import initRand, { rand } from "rand.wasm";

await initRand({
  env: {
    seed: () => () => Math.random() * Date.now(),
  },
});
```

> [!NOTE]
> With **static import syntax**, named exports are proxied until the module is initialized. If you call one of them before init, the proxy runs init without imports and returns a Promise that resolves with the call's result.

### Module compatibility

Some libraries want a [`WebAssembly.Module`](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Module) so they can create the [`WebAssembly.Instance`](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Instance/Instance) themselves. For those cases, add the `?module` suffix to import a `.wasm` file as a Module directly.

```js
import _sumMod from "sum.wasm?module";
const { sum } = await WebAssembly.instantiate(_sumMod).then((i) => i.exports);
```

> [!NOTE]
> Run into a library that needs this? [Open an issue](https://github.com/unjs/unwasm/issues/new/choose) — we would love to help it migrate!

## Integration

unwasm transforms `.wasm` imports into compatible bindings at build time. Today that happens through a Rollup plugin or a dedicated Rspack plugin; more integrations are planned.

### Install

Install the [`unwasm`](https://www.npmjs.com/package/unwasm) npm package:

```sh
# ✨ Auto-detect package manager
npx nypm install unwasm
```

### Builder Plugins

###### Rollup

```js
// rollup.config.js
import { unwasm } from "unwasm/plugin";

export default {
  plugins: [unwasm({/* options */})],
};
```

The same plugin works with [Rolldown](https://rolldown.rs) and [Vite](https://vite.dev).

###### Rspack

```js
// rspack.config.mjs
import { unwasmRspack } from "unwasm/plugin/rspack";

export default {
  plugins: [unwasmRspack({/* options */})],
};
```

> [!NOTE]
> With `esmImport: true`, Rspack must emit ESM output (for example `output.library.type: "modern-module"`) so that the generated `import()` of the `.wasm` asset is preserved.

### Plugin Options

- `esmImport` (default: `false`): Import the `.wasm` file directly instead of bundling it. Required on Cloudflare Workers, and works in any environment with native `.wasm` module imports.
- `lazy` (default: `false`): Import `.wasm` files through a lazily evaluated proxy, for runtimes without top-level `await`.

## Tools

unwasm ships build-time helpers for working with `.wasm` modules directly.

### `parseWasm`

Parses the wasm binary format to extract a module's imports and exports. It is a small, dependency-free reader that decodes only the sections describing the module interface and skips the rest.

```js
import { readFile } from "node:fs/promises";
import { parseWasm } from "unwasm/tools";

const source = await readFile(new URL("examples/sum.wasm", import.meta.url));
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

unwasm can infer the imports object for you and bundle it using import maps (read more: [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap), [Node.js](https://nodejs.org/api/packages.html#imports), and [WICG](https://github.com/WICG/import-maps)).

To tell the bundler how to resolve the imports a `.wasm` file needs, declare them in a parent `package.json`:

```json
{
  "exports": {
    "./rand.wasm": "./rand.wasm"
  },
  "imports": {
    "env": "./env.mjs"
  }
}
```

> [!TIP]
> You can prefix import names with `#` (for example `#env`) to follow Node.js conventions.

## Wasm ESM Imports

Wasm modules can also import from ES modules (read more: [ESM Integration Spec](https://github.com/WebAssembly/esm-integration/tree/main/proposals/esm-integration)).

**Example:**

```wast
(module
  (import "./add-esmi-deps.mjs" "getValue" (func $getValue (result i32)))

  (func (export "addImported") (param $a i32) (result i32)
    local.get $a
    call $getValue
    i32.add
  )
)
```

## Contribution

<details>
  <summary>Local development</summary>

- Clone this repository
- Install the latest LTS version of [Node.js](https://nodejs.org/en/)
- Enable [Corepack](https://github.com/nodejs/corepack) using `corepack enable`
- Install dependencies using `pnpm install`
- Run tests using `pnpm dev` or `pnpm test`

</details>

<!-- /automd -->

## License

<!-- automd:contributors license=MIT author="pi0" -->

Published under the [MIT](https://github.com/unjs/unwasm/blob/main/LICENSE) license.
Made by [@pi0](https://github.com/pi0) and [community](https://github.com/unjs/unwasm/graphs/contributors) 💛
<br><br>
<a href="https://github.com/unjs/unwasm/graphs/contributors">
<img src="https://contrib.rocks/image?repo=unjs/unwasm" />
</a>

<!-- /automd -->

<!-- automd:with-automd -->

---

_🤖 auto updated with [automd](https://automd.unjs.io)_

<!-- /automd -->
