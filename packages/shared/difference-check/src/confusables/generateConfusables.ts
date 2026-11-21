/**
 * Write `confusablesV1.generated.ts` from `confusables.txt`. Run it with `npm run generate:confusables` after the data
 * file changes.
 *
 * @sideEffect Reads the data file and writes the generated module beside it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseConfusables, renderConfusablesModule } from './parseConfusables.js';

const HERE = dirname(fileURLToPath(import.meta.url));

writeFileSync(
    join(HERE, 'confusablesV1.generated.ts'),
    renderConfusablesModule(parseConfusables(readFileSync(join(HERE, 'confusables.txt'), 'utf8'))),
);
