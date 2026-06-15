import tseslint from 'typescript-eslint';
import { createConfig } from '@kitchensink/eslint';

export default tseslint.config(
    ...createConfig('./tsconfig.json', import.meta.dirname),
    {
        // The CloudFront Function source targets the CFF JS-2.0 runtime (untyped `cloudfront` import,
        // no tsconfig project) — it's governed by its own shape test + prettier, not type-aware lint.
        ignores: ['.next/**', 'next-env.d.ts', '**/*.config.*', '**/*.cff.js'],
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
