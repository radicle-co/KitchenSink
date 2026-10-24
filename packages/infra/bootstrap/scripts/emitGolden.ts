/**
 * Regenerates `golden/<qualifier>.yaml` from the vendored stock template.
 *
 * Run after changing the transform, a stack-name pattern or a trust entry; `bootstrapGoldens.test.ts` fails until
 * the committed files match. The change then needs the owner to re-run the bootstrap (see the runbook).
 *
 * @sideEffect Writes the three golden files.
 */
import { writeFileSync } from 'node:fs';

import { goldenPath, renderBootstrapTemplate } from '../src/bootstrapTemplates.js';
import { QUALIFIERS } from '../src/qualifiers.js';

for (const qualifier of Object.values(QUALIFIERS)) {
    writeFileSync(goldenPath(qualifier), renderBootstrapTemplate(qualifier));
}
