import { describe, expect, it } from 'vitest';

import {
    checkScreens,
    flowOutcomes,
    parseScreenRecords,
    renderScreenCheck,
    type ScreenRecord,
} from '../src/screenCheck.js';

const coverage = new Map<string, ReadonlySet<string>>([
    ['recipes/rating', new Set(['HomeScreen', 'RecipeDetailScreen', 'RecipeEditorScreen', 'RecipeVersionsScreen'])],
    ['home', new Set(['HomeScreen', 'RecipeListScreen'])],
]);

const screen = (flow: string, name: string): ScreenRecord => ({ kind: 'screen', flow, screen: name });
const result = (flow: string, outcome: 'passed' | 'failed' | 'skipped'): ScreenRecord => ({
    kind: 'result',
    flow,
    result: outcome,
});

const check = (records: readonly ScreenRecord[], branching: readonly string[] = []) =>
    checkScreens({ records, coverage, branching: new Set(branching) });

describe('parseScreenRecords', () => {
    it('reads screen and result lines', () => {
        const text = 'screen\thome\tHomeScreen\nresult\thome\tpassed\n';

        expect(parseScreenRecords(text, 'f')).toEqual([screen('home', 'HomeScreen'), result('home', 'passed')]);
    });

    it('ignores blank lines', () => {
        expect(parseScreenRecords('\n\nscreen\ta\tB\n\n', 'f')).toEqual([screen('a', 'B')]);
    });

    it.each([
        ['an unknown kind', 'seen\ta\tB'],
        ['a missing field', 'screen\ta'],
        ['an extra field', 'screen\ta\tB\tC'],
        ['an unknown result', 'result\ta\tmaybe'],
        ['an empty screen', 'screen\ta\t'],
    ])('refuses %s, because a reader that skipped damage would read it as "saw nothing"', (_name, line) => {
        expect(() => parseScreenRecords(line, 'f')).toThrow(/f line 1/u);
    });
});

describe('checkScreens', () => {
    it('reports a screen the flow saw and its combined coverage lacks (missing)', () => {
        const found = check([
            screen('home', 'HomeScreen'),
            screen('home', 'RecipeDetailScreen'),
            result('home', 'passed'),
        ]);

        expect(found.missing).toEqual([{ flow: 'home', screens: ['RecipeDetailScreen'] }]);
    });

    it('reports a missing screen for a flow that FAILED too: where it went is true either way', () => {
        const found = check([screen('home', 'RecipeDetailScreen'), result('home', 'failed')]);

        expect(found.missing).toEqual([{ flow: 'home', screens: ['RecipeDetailScreen'] }]);
    });

    it('treats a flow with no row as every screen missing', () => {
        const found = check([screen('mystery', 'HomeScreen'), result('mystery', 'passed')]);

        expect(found.missing).toEqual([{ flow: 'mystery', screens: ['HomeScreen'] }]);
    });

    it('reports a passed flow that recorded nothing (silent)', () => {
        expect(check([result('home', 'passed')]).silent).toEqual(['home']);
    });

    it('does not call a failed or skipped flow silent: it may not have reached anything', () => {
        expect(check([result('home', 'failed'), result('recipes/rating', 'skipped')]).silent).toEqual([]);
    });

    it('reports coverage minus observed for a passed flow (wider)', () => {
        const found = check([screen('home', 'HomeScreen'), result('home', 'passed')]);

        expect(found.wider).toEqual([{ flow: 'home', screens: ['RecipeListScreen'], branching: false }]);
    });

    it('does not report wider rows from a failed flow: it stopped early, so the gap proves nothing', () => {
        expect(check([screen('home', 'HomeScreen'), result('home', 'failed')]).wider).toEqual([]);
    });

    it('marks a wider row whose flow has when: branches, because one run took one branch', () => {
        const found = check([screen('home', 'HomeScreen'), result('home', 'passed')], ['home']);

        expect(found.wider[0]?.branching).toBe(true);
    });

    it('omits a flow that saw everything its row names', () => {
        const found = check([
            screen('home', 'HomeScreen'),
            screen('home', 'RecipeListScreen'),
            result('home', 'passed'),
        ]);

        expect(found).toEqual({ missing: [], silent: [], wider: [] });
    });

    it('counts a screen once however often it was shown', () => {
        const found = check([
            screen('home', 'HomeScreen'),
            screen('home', 'HomeScreen'),
            screen('home', 'RecipeListScreen'),
            result('home', 'passed'),
        ]);

        expect(found.wider).toEqual([]);
    });

    it('sorts every list, so two runs print the same text', () => {
        const found = check([
            screen('home', 'Zed'),
            screen('home', 'Alpha'),
            screen('a', 'X'),
            result('home', 'passed'),
            result('a', 'passed'),
        ]);

        expect(found.missing.map((row) => row.flow)).toEqual(['a', 'home']);
        expect(found.missing[1]?.screens).toEqual(['Alpha', 'Zed']);
    });
});

describe('renderScreenCheck', () => {
    it('is empty for a clean check', () => {
        expect(renderScreenCheck({ missing: [], silent: [], wider: [] }, 'android')).toBe('');
    });

    it('names the platform, the row to grow and the flows that recorded nothing', () => {
        const text = renderScreenCheck(
            {
                missing: [{ flow: 'home', screens: ['RecipeDetailScreen'] }],
                silent: ['a'],
                wider: [{ flow: 'home', screens: ['RecipeListScreen'], branching: true }],
            },
            'ios',
        );

        expect(text).toContain('ios');
        expect(text).toContain('home: add RecipeDetailScreen to its row in maestroFlowScreens.tsv');
        expect(text).toContain('a: passed and recorded no screen');
        expect(text).toContain('home: row is wider than observed by RecipeListScreen (has when: branches');
    });
});

describe('flowOutcomes', () => {
    const results = new Map([
        ['a', 'passed'],
        ['b', 'failed'],
        ['c', 'skipped'],
    ] as const);

    it('counts the expected flows by their recorded result', () => {
        expect(flowOutcomes(['a', 'b', 'c'], results)).toEqual({ passed: 1, failed: 1, skipped: 1 });
    });

    it('counts an expected flow with no result as skipped: it never ran, and a skip is not a pass', () => {
        expect(flowOutcomes(['a', 'never'], results)).toEqual({ passed: 1, failed: 0, skipped: 1 });
    });

    it('ignores a result for a flow nobody expected', () => {
        expect(flowOutcomes(['a'], results)).toEqual({ passed: 1, failed: 0, skipped: 0 });
    });

    it('counts nothing for nothing expected', () => {
        expect(flowOutcomes([], results)).toEqual({ passed: 0, failed: 0, skipped: 0 });
    });
});
