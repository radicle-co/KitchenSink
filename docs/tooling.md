# Tooling Workspaces

Shared tooling configurations live in `packages/tools/`. Each workspace is an npm package referenced by other workspaces as a devDependency.

## Workspaces

### `@commise/tools-eslint`

ESLint flat config with TypeScript support. Includes `typescript-eslint` and `eslint-plugin-import-x`.

**Usage** — reference in your workspace's `eslint.config.js`:

```js
export { default } from '@commise/tools-eslint';
```

### `@commise/tools-prettier`

Shared Prettier config: 4-space indent, 120-char print width, single quotes, trailing commas.

**Usage** — the root `prettier.config.js` imports this package. Workspaces inherit it automatically.

### `@commise/tools-typescript`

Base TypeScript configs: `base.json` (shared compiler options) and `build.json` (for production builds with declaration emit).

**Usage** — extend in your workspace's `tsconfig.json`:

```json
{
    "extends": "@commise/tools-typescript/base.json"
}
```

### `@commise/tools-vitest`

Shared Vitest configuration with sensible defaults.

**Usage** — extend in your workspace's `vitest.config.js`:

```js
import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '@commise/tools-vitest';

export default mergeConfig(
    baseConfig,
    defineConfig({
        /* overrides */
    }),
);
```

### `@commise/tools-esbuild`

esbuild presets for different build targets: `base.js` (shared options), `library.js` (packages), `service.js` (Lambda/backend services).

**Usage** — import the appropriate preset in your build script:

```js
import { libraryConfig } from '@commise/tools-esbuild/library';
```
