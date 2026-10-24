import { createConfig } from '@kitchensink/eslint';

// Two projects: the check project, and the Node scripts with Node's types (`tsconfig.scripts.json` says why).
const base = createConfig(['./tsconfig.json', './tsconfig.scripts.json'], import.meta.dirname);
export default [...base];
