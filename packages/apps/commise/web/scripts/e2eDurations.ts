/**
 * Rewrites the duration table the Playwright lanes are balanced by, from run reports.
 *
 * Usage: `npm run e2e:durations -- <report.json>...` where each report is a merged or single-run JSON report
 * (`test-results/lanes/merged.json` after a lane run). Commit the result.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { durationTable } from './e2eDurationTable';
import { DURATIONS_FILE } from './e2ePaths';
import { parseReport } from './e2eReport';

const files = process.argv.slice(2);

if (files.length === 0) {
    console.error('usage: npm run e2e:durations -- <report.json>...');
    process.exit(1);
}

const table = durationTable(files.map((file) => parseReport(readFileSync(file, 'utf8'))));

writeFileSync(DURATIONS_FILE, `${JSON.stringify(table, null, 4)}\n`);
console.log(`wrote ${Object.keys(table).length} durations to ${DURATIONS_FILE}`);
