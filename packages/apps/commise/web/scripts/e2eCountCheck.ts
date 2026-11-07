/**
 * CI guard: lists the tests a run would execute and fails unless that is the number the selection counted.
 *
 *   tsx scripts/e2eCountCheck.ts <expected> [--test-list <file>]
 *
 * `e2e.sh` runs it before Playwright on the CI path. A list file that lost a test, or a config that stopped listing
 * one, leaves every shard green over a smaller suite; only this comparison notices.
 */
import { fileURLToPath } from 'node:url';

import { countTests, listTests } from './e2eLanes.js';

/**
 * @sideEffect Runs `playwright test --list`.
 * @param args - The expected count, then any Playwright arguments that choose tests.
 * @returns 0 when the counts match, 1 otherwise.
 */
export function main(args: readonly string[]): number {
    const [expectedText, ...rest] = args;
    const expected = Number(expectedText);

    if (expectedText === undefined || !Number.isInteger(expected) || expected < 0) {
        console.error(`error: expected a whole number of tests, got ${JSON.stringify(expectedText)}`);

        return 1;
    }

    const listed = countTests(listTests(rest, undefined, process.env));

    if (listed !== expected) {
        console.error(`error: playwright lists ${listed} tests but the selection counted ${expected}`);

        return 1;
    }

    console.log(`▶ ${listed} tests listed, as the selection counted`);

    return 0;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
    process.exit(main(process.argv.slice(2)));
}
