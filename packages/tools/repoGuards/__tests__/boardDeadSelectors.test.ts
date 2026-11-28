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
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { deadClassSelectors } from './boardDeadSelectors.js';
import { over, raisedAgainst, baselineHistory, stale, type FileCounts } from './ratchetBaseline.js';
import { repoRoot } from './serviceSources.js';

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

    it('reads every <style> block', () => {
        const html = '<style>.one{}</style><div class="x"></div><style>.two{}</style>';
        expect(deadClassSelectors(html)).toEqual(['one', 'two']);
    });
});

const boardFiles = execFileSync('git', ['ls-files', 'docs/design/canvases/**/*.dc.html'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
})
    .split('\n')
    .filter((file) => file !== '');

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
