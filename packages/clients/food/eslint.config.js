import { createConfig } from '@commise/tools-eslint';

const base = createConfig('./tsconfig.json', import.meta.dirname);
export default [...base];
