import { createConfig } from '@kitchensink/eslint';

const base = createConfig('./tsconfig.json', import.meta.dirname);

export default [
    ...base,
    { ignores: ['dist/**'] },
    {
        // Grandfathered pre-existing names that predate the §1a kebab-case enforcement.
        // These files are intentionally NOT renamed here (they are referenced across the
        // codebase and docs); the filename rule is disabled for them only, so no NEW
        // non-conforming name can slip in. Rename to kebab-case in a dedicated follow-up.
        files: ['src/auth/middleware/wsAuth.ts', 'src/users/resolveUser.ts'],
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
