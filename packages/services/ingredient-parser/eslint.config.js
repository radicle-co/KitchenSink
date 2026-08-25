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
];
