# Tooling Workspaces

Shared tooling configurations live in `packages/tools/`. Each workspace is an npm package referenced by other workspaces as a devDependency.

## Workspaces

### `@kitchensink/eslint`

ESLint flat config with TypeScript support. Includes `typescript-eslint` and `eslint-plugin-import-x`.

**Usage** — reference in your workspace's `eslint.config.js`:

```js
export { default } from '@kitchensink/eslint';
```

### `@kitchensink/prettier`

Shared Prettier config: 4-space indent, 120-char print width, single quotes, trailing commas.

**Usage** — the root `prettier.config.js` imports this package. Workspaces inherit it automatically.

### `@kitchensink/typescript`

Base TypeScript configs: `base.json` (shared compiler options) and `build.json` (for production builds with declaration emit).

**Usage** — extend in your workspace's `tsconfig.json`:

```json
{
    "extends": "@kitchensink/typescript/base.json"
}
```

### `@kitchensink/vitest`

Shared Vitest configuration with sensible defaults.

**Usage** — extend in your workspace's `vitest.config.js`:

```js
import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '@kitchensink/vitest';

export default mergeConfig(baseConfig, defineConfig({/* overrides */}));
```

### `@kitchensink/esbuild`

esbuild presets for different build targets: `base.js` (shared options), `library.js` (packages), `service.js` (Lambda/backend services).

**Usage** — import the appropriate preset in your build script:

```js
import { libraryConfig } from '@kitchensink/esbuild/library';
```
