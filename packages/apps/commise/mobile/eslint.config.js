import tseslint from 'typescript-eslint';
import { createConfig } from '@commise/tools-eslint';

export default tseslint.config(...createConfig('./tsconfig.json', import.meta.dirname), {
    ignores: ['scripts/**'],
});
