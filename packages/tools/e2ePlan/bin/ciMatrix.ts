/**
 * Writes the Maestro half of the CI selection to `$GITHUB_OUTPUT` (or stdout when it is unset).
 *
 *   npm run ci:mobile
 *
 * Fails SAFE: if the selector cannot answer, the whole suite runs, as it does for a local door.
 */
import { appendFileSync } from 'node:fs';

import { maestroOutputs } from '../src/ciMatrix.js';
import type { TierJson } from '../src/planJson.js';
import { runPlan } from '../src/runPlan.js';
import { findRepoRoot } from '../src/repoRoot.js';

async function mobileTier(): Promise<TierJson> {
    try {
        return (await runPlan(findRepoRoot(process.cwd(), process.env['INIT_CWD']), process.env)).mobile;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        console.warn(`warning: the selector failed (${message}); running every flow`);

        return { kind: 'all', reasons: ['the selector failed'] };
    }
}

const lines = Object.entries(maestroOutputs(await mobileTier()))
    .map(([key, value]) => `${key}=${value}\n`)
    .join('');
const target = process.env['GITHUB_OUTPUT'];

if (target === undefined || target === '') {
    process.stdout.write(lines);
} else {
    appendFileSync(target, lines);
}
