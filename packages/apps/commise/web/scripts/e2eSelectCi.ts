/**
 * CI step: decides which web specs run and how many shards they need, and writes both to `$GITHUB_OUTPUT`.
 *
 *   tsx scripts/e2eSelectCi.ts
 *
 * The selection is `e2eLanes.ts`'s own (`chooseSelection`), so CI and a developer's door cannot disagree about which
 * specs a change affects. The shard count is `@kitchensink/e2e-plan`'s `webShardCount`, capped by the web pool.
 * `FULL_SUITE=1` runs everything. Outputs: `web_tests`, `web_test_list`, `web_shards`.
 */
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { POOL_ROSTER } from '@kitchensink/e2e-fixtures/testPool';
import { webSelectionOutputs, type WebSelection } from '@kitchensink/e2e-plan/ciMatrix';

import { chooseSelection, countTests, listTests } from './e2eLanes.js';

/** Tests one CI shard should hold. Setup costs about 35 s per shard, so a shard under this is mostly setup. */
export const WEB_TESTS_PER_SHARD = 14;

/**
 * @sideEffect Runs the selector and `playwright test --list`.
 * @param env - The caller's environment.
 * @returns What the web matrix reads.
 */
export async function selectWeb(env: Readonly<Record<string, string | undefined>>): Promise<WebSelection> {
    const choice = await chooseSelection([], env);

    if (choice.kind === 'none') {
        return { kind: 'none' };
    }

    if (choice.kind === 'list') {
        return { kind: 'list', file: choice.file, tests: choice.tests };
    }

    return { kind: 'unselected', tests: countTests(listTests([], undefined, env)) };
}

async function main(): Promise<void> {
    const outputs = webSelectionOutputs(await selectWeb(process.env), WEB_TESTS_PER_SHARD, POOL_ROSTER.web.length);
    const lines = Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}\n`)
        .join('');
    const target = process.env['GITHUB_OUTPUT'];

    if (target === undefined || target === '') {
        process.stdout.write(lines);
    } else {
        appendFileSync(target, lines);
    }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
}
