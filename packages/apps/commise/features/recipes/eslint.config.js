import { createConfig } from '@kitchensink/eslint';

// Three projects: the check project, and two with Node's types: the Node scripts and the font-measuring fit tests
// (`tsconfig.scripts.json` and `tsconfig.fit.json` say why).
const base = createConfig(['./tsconfig.json', './tsconfig.scripts.json', './tsconfig.fit.json'], import.meta.dirname);
export default [...base];
