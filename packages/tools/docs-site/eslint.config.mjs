import { createConfig } from '@kitchensink/eslint';

const base = createConfig('./tsconfig.json', import.meta.dirname);

export default [
    ...base,
    {
        // Docusaurus writes its own build artefacts here; they are generated output, not source.
        ignores: ['build/**', '.docusaurus/**'],
    },
];
