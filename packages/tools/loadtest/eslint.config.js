import { createConfig } from '@kitchensink/eslint';

const base = createConfig('./tsconfig.json', import.meta.dirname);

export default [
    // ⛔ The `.mjs` here are NODE scripts (`run.mjs`, `sweep.mjs`, `install-k6.mjs`, `auth/*.mjs`) and the
    // root `.js` are k6 SCRIPTS executed by the k6 binary's goja runtime. Neither is a typed source, so both
    // sit outside `tsconfig.json` and the type-aware config cannot parse them.
    //
    // ⚠️ THIS IGNORE USED TO BE `**/*.js` TOO, and that was too wide: it excluded `k6/session.js` — the
    // shared Clerk re-mint, the one module here that carries credentials into every deployed run — so the
    // file was linted by NOTHING while the package reported clean. The shared config declares k6's four
    // globals for `tools/loadtest/k6/**`, which is the reason this ignore existed (56 wrong `no-undef`
    // errors), so that directory is now linted properly instead of skipped.
    { ignores: ['**/*.mjs', '*.js', 'auth/*.js', 'observe/*.js'] },
    ...base,
];
