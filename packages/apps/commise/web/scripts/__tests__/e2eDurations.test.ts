// @vitest-environment node
/**
 * The duration table (`tests/e2e/testDurations.json`) balances the Playwright lanes. A table that drifts from the
 * suite still runs, but it balances badly, and nothing else would say so. This guard reads the spec files on disk,
 * so it can tell without starting Playwright.
 *
 * Fix a failure with `npm run e2e:durations -- <a merged lane report>` and commit the table.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const E2E_DIR = fileURLToPath(new URL('../../tests/e2e/', import.meta.url));

const table: Record<string, number> = JSON.parse(readFileSync(`${E2E_DIR}testDurations.json`, 'utf8'));

/** The spec file named by a table id: `project › file › …`. */
const specOf = (id: string): string => id.split(' › ')[1] ?? '';

const specsOnDisk = readdirSync(E2E_DIR)
    .filter((name) => name.endsWith('.spec.ts'))
    .sort();

describe('the Playwright duration table', () => {
    it('has a duration for every spec file, so a new spec cannot be balanced as if it took the median', () => {
        const timed = new Set(Object.keys(table).map(specOf));

        expect(specsOnDisk.filter((spec) => !timed.has(spec))).toEqual([]);
    });

    it('holds nothing for a spec file that no longer exists', () => {
        const onDisk = new Set(specsOnDisk);

        expect([...new Set(Object.keys(table).map(specOf))].filter((spec) => !onDisk.has(spec))).toEqual([]);
    });

    it('holds only real, positive durations', () => {
        expect(Object.entries(table).filter(([, ms]) => !Number.isFinite(ms) || ms < 0)).toEqual([]);
    });

    it('is written with sorted keys, so a regeneration diffs by what changed', () => {
        const keys = Object.keys(table);

        expect(keys).toEqual([...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    });
});
