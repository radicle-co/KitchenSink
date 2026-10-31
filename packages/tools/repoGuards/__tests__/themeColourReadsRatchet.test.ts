/**
 * G3 (ADR-0080): role colours and press fills read through `useTheme()` only fall. Under Tamagui a colour is a theme
 * token (`$paper`, `$paperPress`) that follows the scheme with no hook, so each read `themeColourReads.ts` finds is a
 * colour still applied by hand. The counts are held per file in `themeColourReadsBaseline.json` by the same rules as
 * the StyleSheet ratchet (`ratchetBaseline.ts`): no file above its count, no new file with any, a drop recorded in the
 * same change, and no count above the lowest any version of the baseline recorded.
 *
 * ✅ THE FIX FOR A FAILURE: read the colour as a theme token on a Tamagui element or in `styled()`, then lower the
 * file's count, or remove its entry at zero.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { nativeSources } from './nativeSources.js';
import { over, raisedAgainst, baselineHistory, stale, type FileCounts } from './ratchetBaseline.js';
import { repoRoot } from './serviceSources.js';
import { themeColourReads, type ThemeReads } from './themeColourReads.js';

const BASELINE_PATH = 'packages/tools/repoGuards/__tests__/themeColourReadsBaseline.json';

interface Baseline {
    readonly colourReads: FileCounts;
    readonly pressReads: FileCounts;
}

const baseline = JSON.parse(readFileSync(path.join(repoRoot, BASELINE_PATH), 'utf8')) as Baseline;

const readsOf = new Map<string, ThemeReads>(
    nativeSources().map((file) => [file, themeColourReads(readFileSync(path.join(repoRoot, file), 'utf8'), file)]),
);

function countsBy(pick: (reads: ThemeReads) => number): FileCounts {
    return Object.fromEntries(
        [...readsOf].map(([file, reads]) => [file, pick(reads)] as const).filter(([, count]) => count > 0),
    );
}

const colourCounts = countsBy((reads) => reads.colour.length);

const pressCounts = countsBy((reads) => reads.press.length);

describe('theme colour reads only fall (ADR-0080)', () => {
    it('reads real uses, so an empty baseline cannot pass by reading nothing', () => {
        expect(readsOf.get('packages/apps/commise/ui/src/button/Button.native.tsx')?.colour.length).toBeGreaterThan(0);
    });

    it('lets no file exceed its recorded count, and no unrecorded file have any', () => {
        expect(over(colourCounts, baseline.colourReads)).toEqual([]);
        expect(over(pressCounts, baseline.pressReads)).toEqual([]);
    });

    it('records no file above its true count; a drop is written down in the same change', () => {
        expect(stale(colourCounts, baseline.colourReads)).toEqual([]);
        expect(stale(pressCounts, baseline.pressReads)).toEqual([]);
    });

    it('only lowers the baseline: no count above the lowest its history recorded, and no path added to it', () => {
        const history = baselineHistory<Baseline>(BASELINE_PATH);

        // The baseline is committed, so its history is never empty; an empty one means the history read failed.
        expect(history.length, 'no committed baseline found in history').toBeGreaterThan(0);

        const raised = raisedAgainst(history, [
            [
                baseline.colourReads,
                (version) => version.colourReads,
                (file, source) => themeColourReads(source, file).colour.length,
            ],
            [
                baseline.pressReads,
                (version) => version.pressReads,
                (file, source) => themeColourReads(source, file).press.length,
            ],
        ]);

        expect(raised).toEqual([]);
    });
});
