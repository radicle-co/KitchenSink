import { createRequire } from 'node:module';

/**
 * Shared Prettier config from `@kitchensink/prettier`, loaded WITHOUT an
 * `import ... with { type: 'json' }` attribute. That attribute syntax is unparseable on Node < 20.10
 * (and < 18.20), and the git hooks (husky → lint-staged) run under whatever Node happens to be on PATH —
 * often the shell's default (e.g. v18.x) rather than the repo's Node 24 — which crashed Prettier with
 * `Unexpected token 'with'` while loading its own config, failing every pre-commit hook. `createRequire`
 * + a JSON `require` resolves the same shared config on every supported Node version.
 */
export default createRequire(import.meta.url)('@kitchensink/prettier');
