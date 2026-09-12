import { createConfig } from '@kitchensink/eslint';

const base = createConfig('./tsconfig.json', import.meta.dirname);

export default [
    ...base,
    {
        // Grandfathered pre-existing camelCase names that predate the §1a kebab-case
        // enforcement (the rest of this Lambda package is already kebab-case). Referenced
        // by name in the architecture docs, so intentionally NOT renamed here — the filename
        // rule is disabled for them only. Rename to kebab-case in a dedicated follow-up.
        files: [
            'src/common/identityClient.ts',
            'src/common/__tests__/identityClient.test.ts',
            'src/handlers/identityWebhook.ts',
            'src/handlers/__tests__/identityWebhook.test.ts',
        ],
        rules: {
            'check-file/filename-naming-convention': 'off',
        },
    },
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
