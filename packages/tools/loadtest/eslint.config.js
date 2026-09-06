import { createConfig } from '@kitchensink/eslint';

const base = createConfig('./tsconfig.json', import.meta.dirname);

export default [
    // ⛔ The `.js`/`.mjs` here are k6 SCRIPTS, executed by the k6 binary's goja runtime — not Node modules.
    // They legitimately reference k6's globals (`__ENV`, `__VU`, `__ITER`, `open`), which this config has no
    // way to know about, so linting them produces 56 `no-undef` errors that are all wrong. Linting the
    // TypeScript is the point: before this package had a `lint` script at all, `provisionPool.ts` and
    // `src/` were checked by nothing.
    { ignores: ['**/*.js', '**/*.mjs'] },
    ...base,
];
