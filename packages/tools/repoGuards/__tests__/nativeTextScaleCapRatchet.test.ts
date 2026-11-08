/**
 * Native text that grows past the 2× cap only falls (ADR-0080 §8). Each React Native text `nativeTextScaleCap.ts`
 * finds grows with the system's text size without limit. The counts are held per file in
 * `nativeTextScaleCapBaseline.json` by the same rules as the styling ratchet (`ratchetBaseline.ts`): no file above its
 * count, no new file with any, a drop recorded in the same change, and no count above the lowest any version of the
 * baseline recorded.
 *
 * ✅ THE FIX FOR A FAILURE: set the text with the design system's `Text` (`@commise/ui/text`), or, in a design-system
 * leaf not yet ported, give the React Native text `maxFontSizeMultiplier={FONT_SCALE_CAP}`; then lower the file's
 * count, or remove its entry at zero.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { nativeSources } from './nativeSources.js';
import { uncappedTexts } from './nativeTextScaleCap.js';
import { over, raisedAgainst, baselineHistory, stale, type FileCounts } from './ratchetBaseline.js';
import { repoRoot } from './serviceSources.js';
import { designSystemStyledKinds } from './tamaguiElements.js';

const BASELINE_PATH = 'packages/tools/repoGuards/__tests__/nativeTextScaleCapBaseline.json';

interface Baseline {
    readonly files: FileCounts;
}

const baseline = JSON.parse(readFileSync(path.join(repoRoot, BASELINE_PATH), 'utf8')) as Baseline;

const countOf = (file: string, source: string): number => uncappedTexts(source, file, designSystemStyledKinds).length;

const counts: FileCounts = Object.fromEntries(
    nativeSources()
        .map((file) => [file, countOf(file, readFileSync(path.join(repoRoot, file), 'utf8'))] as const)
        .filter(([, count]) => count > 0),
);

describe('native text past the 2× cap only falls (ADR-0080 §8)', () => {
    it('reads real uses, so an empty baseline cannot pass by reading nothing', () => {
        expect(Object.keys(counts).length).toBeGreaterThan(0);
    });

    it('lets no file exceed its recorded count, and no unrecorded file have any', () => {
        expect(over(counts, baseline.files)).toEqual([]);
    });

    it('records no file above its true count; a drop is written down in the same change', () => {
        expect(stale(counts, baseline.files)).toEqual([]);
    });

    it('only lowers the baseline: no count above the lowest its history recorded, and no path added to it', () => {
        const history = baselineHistory<Baseline>(BASELINE_PATH);

        // The baseline is committed, so its history is never empty; an empty one means the history read failed.
        expect(history.length, 'no committed baseline found in history').toBeGreaterThan(0);
        expect(raisedAgainst(history, [[baseline.files, (version) => version.files, countOf]])).toEqual([]);
    });
});
