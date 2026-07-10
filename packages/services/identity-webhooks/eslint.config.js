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
];
