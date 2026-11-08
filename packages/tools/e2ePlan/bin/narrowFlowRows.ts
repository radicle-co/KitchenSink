/**
 * Narrows `maestroFlowScreens.tsv` from the two platforms' screen reports (`screenEvidence`) (ADR-0086, section 4).
 *
 *   npx tsx bin/narrowFlowRows.ts --android <android.json> --ios <ios.json> [--write] [--repo <path>]
 *
 * Without `--write` it only prints what it would remove and why every other row stays.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { narrowRows, renderTable } from '../src/narrowFlowRows.js';
import { FLOW_TABLE_PATH, loadNarrowInput } from '../src/narrowFlowRowsRepo.js';
import { evidenceOf, parseScreenEvidence } from '../src/screenEvidence.js';
import { findRepoRoot } from '../src/repoRoot.js';

const { values } = parseArgs({
    options: {
        android: { type: 'string' },
        ios: { type: 'string' },
        write: { type: 'boolean', default: false },
        repo: { type: 'string' },
    },
});

if (values.android === undefined || values.ios === undefined) {
    process.stderr.write('usage: narrowFlowRows --android <android.json> --ios <ios.json> [--write]\n');
    process.exit(2);
}

const repo = values.repo !== undefined ? resolve(values.repo) : findRepoRoot(process.cwd(), process.env['INIT_CWD']);
const { input, text } = loadNarrowInput(
    repo,
    evidenceOf(parseScreenEvidence(readFileSync(values.android, 'utf8'), values.android)),
    evidenceOf(parseScreenEvidence(readFileSync(values.ios, 'utf8'), values.ios)),
);
const result = narrowRows(input);

for (const { flow, screens } of result.removed) {
    process.stdout.write(`${flow}: remove ${screens.join(', ')}\n`);
}

for (const { flow, screens } of result.owedAdditions) {
    process.stdout.write(`${flow}: owed addition (a platform showed it, the row lacks it) ${screens.join(', ')}\n`);
}

const byReason = new Map<string, string[]>();

for (const { flow, reason } of result.kept) {
    byReason.set(reason, [...(byReason.get(reason) ?? []), flow]);
}

for (const [reason, flows] of byReason) {
    process.stdout.write(`kept (${reason}): ${flows.length}\n  ${flows.join(', ')}\n`);
}

if (values.write) {
    writeFileSync(
        join(repo, FLOW_TABLE_PATH),
        renderTable(text, new Map(result.removed.map(({ flow, screens }) => [flow, screens]))),
    );
}
