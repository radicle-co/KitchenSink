/**
 * A screen board carries only the CSS rules it draws. A class selector that no element in the board uses is dead CSS:
 * it makes the board look like it draws something it does not, and it is what a build script leaves behind when it
 * copies a shared stylesheet whole. The detector (`deadClassSelectors` in `@kitchensink/board-css`) reads every board under
 * `docs/design/canvases/`, and the dead selectors are held per board in `boardUnusedSelectorsBaseline.json` by the
 * rules in `ratchetBaseline.ts`.
 *
 * ✅ THE FIX FOR A FAILURE: delete the rule from the board's `<style>` (in the build script that emits it, not by
 * hand in the board), then lower the board's count in the baseline, or remove its entry at zero.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { deadClassSelectors } from '@kitchensink/board-css/deadClassSelectors';

import { over, raisedAgainst, baselineHistory, stale, type FileCounts } from './ratchetBaseline.js';
import { repoRoot, trackedFiles } from './serviceSources.js';

const BASELINE_PATH = 'packages/tools/repoGuards/__tests__/boardUnusedSelectorsBaseline.json';

interface Baseline {
    readonly files: FileCounts;
}

const boardFiles = trackedFiles('docs/design/canvases').filter((file) => file.endsWith('.dc.html'));

const countOf = (_file: string, html: string): number => deadClassSelectors(html).length;

const baseline = JSON.parse(readFileSync(path.join(repoRoot, BASELINE_PATH), 'utf8')) as Baseline;

const counts: FileCounts = Object.fromEntries(
    boardFiles
        .map((file) => [file, countOf(file, readFileSync(path.join(repoRoot, file), 'utf8'))] as const)
        .filter(([, count]) => count > 0),
);

describe('dead selectors in the boards only fall', () => {
    it('reads real boards, so an empty list cannot pass by reading nothing', () => {
        expect(boardFiles.length).toBeGreaterThan(0);
    });

    it('lets no board exceed its recorded count, and no unrecorded board have any', () => {
        expect(over(counts, baseline.files)).toEqual([]);
    });

    it('records no board above its true count; a drop is written down in the same change', () => {
        expect(stale(counts, baseline.files)).toEqual([]);
    });

    it('only lowers the baseline: no count above the lowest its history recorded', () => {
        const history = baselineHistory<Baseline>(BASELINE_PATH);

        expect(history.length, 'no committed baseline found in history').toBeGreaterThan(0);
        expect(raisedAgainst(history, [[baseline.files, (version) => version.files, countOf]])).toEqual([]);
    });
});
