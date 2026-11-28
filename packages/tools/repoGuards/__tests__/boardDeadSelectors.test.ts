/**
 * A screen board carries only the CSS rules it draws. A class selector that no element in the board uses is dead CSS:
 * it makes the board look like it draws something it does not, and it is what a build script leaves behind when it
 * copies a shared stylesheet whole. The detector (`boardDeadSelectors.ts`) reads every board under
 * `docs/design/canvases/`, and the dead selectors are held per board in `boardDeadSelectorsBaseline.json` by the
 * rules in `ratchetBaseline.ts`.
 *
 * ✅ THE FIX FOR A FAILURE: delete the rule from the board's `<style>` (in the build script that emits it, not by
 * hand in the board), then lower the board's count in the baseline, or remove its entry at zero.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { admitsAtCutover, deadClassSelectors } from './boardDeadSelectors.js';
import { over, raisedAgainst, baselineHistory, stale, trackedAt, type FileCounts } from './ratchetBaseline.js';
import { repoRoot, trackedFiles } from './serviceSources.js';

const BASELINE_PATH = 'packages/tools/repoGuards/__tests__/boardDeadSelectorsBaseline.json';

interface Baseline {
    readonly files: FileCounts;
}

/** A board with the given `<style>` and body. */
const board = (css: string, body = '<div class="used">x</div>', script = ''): string =>
    `<html><head><style>${css}</style></head><body>${body}<script>${script}</script></body></html>`;

describe('deadClassSelectors', () => {
    it('reports a class selector no element carries', () => {
        expect(deadClassSelectors(board('.used{color:red} .ghost{color:blue}'))).toEqual(['ghost']);
    });

    it('reports nothing when every selector class is used', () => {
        expect(deadClassSelectors(board('.used{color:red}'))).toEqual([]);
    });

    it('reads a class inside @media', () => {
        expect(deadClassSelectors(board('@media (min-width:600px){.ghost{color:red}}'))).toEqual(['ghost']);
    });

    it('reads classes inside :is() and :not()', () => {
        expect(deadClassSelectors(board(':is(.used,.ghost){color:red} .used:not(.shade){color:blue}'))).toEqual([
            'ghost',
            'shade',
        ]);
    });

    it('does not read an attribute selector or a content string as a class', () => {
        const css = '[class~=attrOnly]{color:red} .used::after{content:".inString"}';
        expect(deadClassSelectors(board(css))).toEqual([]);
    });

    it('does not read a class name in a keyframe or a declaration value', () => {
        expect(deadClassSelectors(board('@keyframes spin{0%{opacity:0}} .used{animation:spin 1s}'))).toEqual([]);
    });

    it('counts a class set by script as used, the safe direction', () => {
        const html = board('.used{} .byScript{}', '<div class="used"></div>', "el.classList.add('byScript')");
        expect(deadClassSelectors(html)).toEqual([]);
    });

    it('counts a class on any element, among several, as used', () => {
        expect(deadClassSelectors(board('.a{} .b{}', '<p class="x a"></p><i class="b y"></i>'))).toEqual([]);
    });

    it('does not count a class that appears only as visible text or inside <style>', () => {
        expect(deadClassSelectors(board('.word{}', '<p>word</p>'))).toEqual(['word']);
    });

    it('counts a class used only inside a <template> as used', () => {
        expect(
            deadClassSelectors(board('.inTemplate{} .ghost{}', '<template><i class="inTemplate"></i></template>')),
        ).toEqual(['ghost']);
    });

    it('reads every <style> block', () => {
        const html = '<style>.one{}</style><div class="x"></div><style>.two{}</style>';
        expect(deadClassSelectors(html)).toEqual(['one', 'two']);
    });
});

const boardFiles = trackedFiles('docs/design/canvases').filter((file) => file.endsWith('.dc.html'));

/** The boards on `origin/main`. */
const onMain = trackedAt('origin/main', 'docs/design/canvases');

/** Whether the baseline itself is on `origin/main` yet. */
const baselineOnMain = trackedAt('origin/main', BASELINE_PATH).has(BASELINE_PATH);

const countOf = (_file: string, html: string): number => deadClassSelectors(html).length;

const baseline = JSON.parse(readFileSync(path.join(repoRoot, BASELINE_PATH), 'utf8')) as Baseline;

const counts: FileCounts = Object.fromEntries(
    boardFiles
        .map((file) => [file, countOf(file, readFileSync(path.join(repoRoot, file), 'utf8'))] as const)
        .filter(([, count]) => count > 0),
);

describe('admitsAtCutover', () => {
    const main = new Set(['a.dc.html']);
    const pick = (version: { files: FileCounts }): FileCounts => version.files;
    // A PR's own commit records its row; origin/main's version, appended last, does not.
    const history = (row: FileCounts) => [
        { revision: 'pr', baseline: { files: row } },
        { revision: 'main', baseline: { files: {} as FileCounts } },
    ];
    const refused = (file: string, count: number, onMainSet: ReadonlySet<string>, landed: boolean): string[] =>
        raisedAgainst(history({ [file]: count }), [
            [{ [file]: count }, pick, undefined, admitsAtCutover(onMainSet, landed)],
        ]);

    it('admits a board on main before the baseline has landed on main', () => {
        expect(admitsAtCutover(main, false)?.('a.dc.html')).toBe(true);
        expect(refused('a.dc.html', 30, main, false)).toEqual([]);
    });

    it('refuses a board that is not on main before the baseline has landed', () => {
        expect(admitsAtCutover(main, false)?.('new.dc.html')).toBe(false);
    });

    it('runs the ratchet strict once the baseline is on main: no admit rule at all', () => {
        expect(admitsAtCutover(main, true)).toBeUndefined();
    });

    it('refuses a clean board on main that gains dead selectors after landing', () => {
        expect(refused('a.dc.html', 30, main, true)).toHaveLength(1);
    });

    it('refuses a new board after landing', () => {
        expect(refused('new.dc.html', 50, main, true)).toHaveLength(1);
    });
});

describe('the admission of boards already on main', () => {
    const history = [{ revision: 'abc', baseline: { files: {} as FileCounts } }];
    const pick = (version: { files: FileCounts }): FileCounts => version.files;

    it('admits a board on main that no baseline version recorded', () => {
        expect(raisedAgainst(history, [[{ 'a.dc.html': 5 }, pick, undefined, (file) => file === 'a.dc.html']])).toEqual(
            [],
        );
    });

    it('refuses a board that is not on main and that no baseline version recorded', () => {
        expect(raisedAgainst(history, [[{ 'new.dc.html': 5 }, pick, undefined, () => false]])).toHaveLength(1);
    });

    it('reads real boards from origin/main, so an empty set cannot admit nothing silently', () => {
        expect(onMain.size).toBeGreaterThan(0);
    });
});

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
        const admit = admitsAtCutover(onMain, baselineOnMain);

        expect(raisedAgainst(history, [[baseline.files, (version) => version.files, countOf, admit]])).toEqual([]);
    });
});
