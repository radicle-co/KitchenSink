/**
 * The count of icon-only controls built by hand only falls. `IconButton` owns the target, the focus ring, the press
 * fill and the dim of a control that holds one glyph, so each control `iconOnlyControls.ts` finds outside it is a copy
 * of that look. The counts are held per file in `iconOnlyControlsBaseline.json` by the same rules as the other ratchets
 * (`ratchetBaseline.ts`): no file above its count, no new file with any, a drop recorded in the same change, and no
 * count above the lowest any version of the baseline recorded.
 *
 * The four primitive leaves are not read. They are the controls that every other site becomes, and a register here
 * names them, with a row that each still exists and a row that the detector counts `IconButton.tsx` when it is read, so
 * the register is the only thing keeping it out.
 *
 * ✅ THE FIX FOR A FAILURE: render `IconButton` (or `HeroButton` over a photo) with the handler and the label, then
 * lower the file's count, or remove its entry at zero.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { appSourceModules } from './appSources.js';
import { iconOnlyControls } from './iconOnlyControls.js';
import { over, raisedAgainst, baselineHistory, stale, type FileCounts } from './ratchetBaseline.js';
import { repoRoot } from './serviceSources.js';

const BASELINE_PATH = 'packages/tools/repoGuards/__tests__/iconOnlyControlsBaseline.json';

const UI = 'packages/apps/commise/ui/src';

/** The primitives every icon-only control becomes: the only places a hand-built one is the point. */
const PRIMITIVE_LEAVES: readonly string[] = [
    `${UI}/iconButton/IconButton.tsx`,
    `${UI}/iconButton/IconButton.native.tsx`,
    `${UI}/heroButton/HeroButton.tsx`,
    `${UI}/heroButton/HeroButton.native.tsx`,
];

interface Baseline {
    readonly controls: FileCounts;
}

const baseline = JSON.parse(readFileSync(path.join(repoRoot, BASELINE_PATH), 'utf8')) as Baseline;

const read = (file: string): string => readFileSync(path.join(repoRoot, file), 'utf8');

const counts: FileCounts = Object.fromEntries(
    appSourceModules()
        .filter((file) => file.endsWith('.tsx') && !PRIMITIVE_LEAVES.includes(file))
        .map((file) => [file, iconOnlyControls(read(file), file).length] as const)
        .filter(([, count]) => count > 0),
);

describe('icon-only controls only fall', () => {
    it('reads real uses, so an empty baseline cannot pass by reading nothing', () => {
        // A file that still holds one: SheetPanel moved onto `IconButton`, so it no longer reads as one.
        expect(counts['packages/apps/commise/features/recipes/src/discovery/DiscoveryFooter.tsx']).toBeGreaterThan(0);
    });

    it('registers primitives that exist, and the detector sees a primitive when it is read', () => {
        expect(PRIMITIVE_LEAVES.filter((file) => !existsSync(path.join(repoRoot, file)))).toEqual([]);
        expect(
            iconOnlyControls(read(`${UI}/iconButton/IconButton.tsx`), `${UI}/iconButton/IconButton.tsx`).length,
        ).toBeGreaterThan(0);
    });

    it('lets no file exceed its recorded count, and no unrecorded file have any', () => {
        expect(over(counts, baseline.controls)).toEqual([]);
    });

    it('records no file above its true count; a drop is written down in the same change', () => {
        expect(stale(counts, baseline.controls)).toEqual([]);
    });

    it('only lowers the baseline: no count above the lowest its history recorded, and no path added to it', () => {
        const history = baselineHistory<Baseline>(BASELINE_PATH);

        // The baseline is committed, so its history is never empty; an empty one means the history read failed.
        expect(history.length, 'no committed baseline found in history').toBeGreaterThan(0);

        expect(
            raisedAgainst(history, [
                [
                    baseline.controls,
                    (version) => version.controls,
                    (file, source) => iconOnlyControls(source, file).length,
                ],
            ]),
        ).toEqual([]);
    });
});
