import tseslint from 'typescript-eslint';
import { createConfig } from '@kitchensink/eslint';

export default tseslint.config(
    ...createConfig('./tsconfig.json', import.meta.dirname),
    {
        // The CloudFront Function source targets the CFF JS-2.0 runtime (untyped `cloudfront` import,
        // no tsconfig project) — it's governed by its own shape test + prettier, not type-aware lint.
        //
        // ⚠️ `*.config.*` is anchored to the workspace ROOT and NOT written `**\/*.config.*`. The recursive form
        // also matched `src/sentry.edge.config.ts` and `src/sentry.server.config.ts` — the Sentry initialisation
        // for the edge and Node runtimes, ordinary application code — so those two shipped unlinted. The
        // exemption is only ever meant for a root tool manifest (`next.config.ts`, `playwright.config.ts`), which
        // is what the shared config in `packages/tools/eslint` excludes and what
        // `__tests__/static-analysis-coverage.test.ts` pins.
        ignores: ['.next/**', 'next-env.d.ts', '*.config.*', '**/*.cff.js'],
    },
    {
        files: ['tests/**/*.ts', 'tests/**/*.tsx'],
        languageOptions: {
            parserOptions: {
                project: './tsconfig.test.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        // CDK infra has its own tsconfig project; point the type-aware parser at it for infra files.
        files: ['infra/**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: './infra/tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
);
