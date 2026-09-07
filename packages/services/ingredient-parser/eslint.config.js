import { createConfig } from '@kitchensink/eslint';

const base = createConfig('./tsconfig.json', import.meta.dirname);

export default [
    ...base,
    // `build/` is the staged Lambda asset — pip's output, plus vendored third-party Python. Nothing in it is
    // ours and nothing in it is TypeScript. `dist/` is compiled output.
    { ignores: ['dist/**', 'build/**', 'infra/dist/**'] },
    {
        // CDK infra is a SEPARATE tsconfig project, so type-aware lint needs the parser pointed at it — the
        // same block food-service and @commise/web carry. Without it every `infra/**` file is a FATAL parse
        // error: a file ESLint opens and runs no rule on, which is worse than not linting it, because the
        // file still appears in a passing run.
        files: ['infra/**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: './infra/tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        // ⚠️ NARROWER, and it must stay AFTER the block above (flat config: the last match wins). The
        // deploy-time engine smoke and its suite live under `infra/` but belong to the PACKAGE project,
        // because they import the package's own zod from `src/` — outside `infra/tsconfig.json`'s `rootDir`.
        // Without this override the parser is pointed at a project that does not contain them and every rule
        // is replaced by a fatal parse error: a file ESLint opens, lints with nothing, and still counts as
        // passing. That is the failure the block above already warns about, one directory down.
        files: ['infra/smoke/**/*.ts', 'infra/__tests__/deployedSmoke.test.ts'],
        languageOptions: {
            parserOptions: {
                project: './tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
];
