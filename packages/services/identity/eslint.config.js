import { createConfig } from '@kitchensink/eslint';

const base = createConfig('./tsconfig.json', import.meta.dirname);

export default [
    ...base,
    { ignores: ['infra/**', 'dist/**'] },
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
];
