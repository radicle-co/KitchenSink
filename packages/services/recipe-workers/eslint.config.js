import { createConfig } from '@kitchensink/eslint';

const base = createConfig('./tsconfig.json', import.meta.dirname);

export default [
    ...base,
    {
        // CDK infra is a SEPARATE tsconfig project, so type-aware lint needs the parser pointed at it — the same
        // block `@commise/web` already carries. Without it every `infra/**` file is a FATAL parse error ("not
        // found in any of the provided project(s)"): a file ESLint opens and runs no rule on, which is worse than
        // not linting it, because the file still appears in a passing run. The previous workaround was
        // `ignores: ['infra/**']`, which hid the CDK code that provisions production from the entire config —
        // including the `sql.raw` ban and the bracket-notation env rule.
        files: ['infra/**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: './infra/tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
];
