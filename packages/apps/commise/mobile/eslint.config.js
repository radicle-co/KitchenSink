import tseslint from 'typescript-eslint';
import { createConfig } from '@kitchensink/eslint';

export default tseslint.config(...createConfig(['./tsconfig.json', './tsconfig.fit.json'], import.meta.dirname), {
    ignores: ['scripts/**'],
});
