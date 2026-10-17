import { createConfig } from '@kitchensink/eslint';

const base = createConfig('./tsconfig.json', import.meta.dirname);

export default [
    ...base,
    // `build/` is the staged Lambda asset — pip's output, plus vendored third-party Python. Nothing in it is
    // ours and nothing in it is TypeScript. `dist/` is compiled output.
    // ⚠️ `infra/**` is ignored HERE because it is a separate package now, with its own eslint config and
    // its own tsconfig — it is linted by `cdk-checks`, not by this workspace. That is the opposite of the
    // trap food-service's config warns about, where ignoring infra hid CDK code from EVERY config.
    { ignores: ['dist/**', 'build/**', 'infra/**'] },
    // ⛔ The `infra/**` parser block that stood here is GONE with the ignore above. It pointed
    // @typescript-eslint at `infra/tsconfig.json` so type-aware rules could run on the CDK app; that app is
    // its own package now and `cdk-checks` lints it with its own config. A block matching files this config
    // ignores can never fire — dead configuration that reads like coverage.
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
