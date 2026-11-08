import { describe, expect, it } from 'vitest';

import { narrowRows, renderTable, type NarrowInput } from '../src/narrowFlowRows.js';

const lines = (...rows: string[]): string => rows.join('\n');

const observed = (wider: string[], added: string[] = [], result: 'passed' | 'failed' | 'skipped' = 'passed') => ({
    result,
    wider: new Set(wider),
    added: new Set(added),
});

/** One flow, `recipes/a`, whose row is Home, Versions, Editor; both platforms found Versions unobserved. */
function input(over: Partial<NarrowInput> = {}): NarrowInput {
    return {
        table: new Map([
            ['recipes/a', new Set(['HomeScreen', 'RecipeVersionsScreen', 'RecipeEditorScreen'])],
            ['auth/signin', new Set(['HomeScreen', 'login'])],
        ]),
        subflows: new Set(['auth/signin']),
        suppliedBySubflows: () => new Set(['login']),
        branching: new Set(),
        android: new Map([['recipes/a', observed(['RecipeVersionsScreen'])]]),
        ios: new Map([['recipes/a', observed(['RecipeVersionsScreen'])]]),
        ...over,
    };
}

const removedOf = (result: ReturnType<typeof narrowRows>): ReadonlyMap<string, readonly string[]> =>
    new Map(result.removed.map((entry) => [entry.flow, entry.screens]));

describe('narrowRows', () => {
    it('removes a screen both platforms saw the passing flow go without', () => {
        const result = narrowRows(input());

        expect(removedOf(result).get('recipes/a')).toEqual(['RecipeVersionsScreen']);
        expect(result.table.get('recipes/a')).toEqual(new Set(['HomeScreen', 'RecipeEditorScreen']));
    });

    it('keeps a screen that only one platform found unobserved', () => {
        const result = narrowRows(input({ ios: new Map([['recipes/a', observed(['RecipeEditorScreen'])]]) }));

        expect(result.removed).toEqual([]);
    });

    it('keeps a screen the other platform observed, however the first reads it', () => {
        const result = narrowRows(
            input({
                android: new Map([['recipes/a', observed(['RecipeVersionsScreen'], ['RecipeVersionsScreen'])]]),
            }),
        );

        expect(result.removed).toEqual([]);
    });

    it('keeps a screen the iOS run observed, as it keeps one Android observed', () => {
        const result = narrowRows(
            input({ ios: new Map([['recipes/a', observed(['RecipeVersionsScreen'], ['RecipeVersionsScreen'])]]) }),
        );

        expect(result.removed).toEqual([]);
    });

    it('keeps a flow that did not pass on a platform, whatever it printed', () => {
        const result = narrowRows(
            input({ ios: new Map([['recipes/a', observed(['RecipeVersionsScreen'], [], 'failed')]]) }),
        );

        expect(result.removed).toEqual([]);
        expect(result.kept).toContainEqual({ flow: 'recipes/a', reason: expect.stringMatching(/ios.*did not pass/u) });
    });

    it('keeps a flow that has no evidence from one platform, and says which', () => {
        const result = narrowRows(input({ ios: new Map() }));

        expect(result.removed).toEqual([]);
        expect(result.kept).toContainEqual({ flow: 'recipes/a', reason: expect.stringMatching(/ios/u) });
    });

    it('keeps a flow with when: branches, where one run takes one branch', () => {
        const result = narrowRows(input({ branching: new Set(['recipes/a']) }));

        expect(result.removed).toEqual([]);
        expect(result.kept).toContainEqual({ flow: 'recipes/a', reason: expect.stringMatching(/when:/u) });
    });

    it('never removes a screen a sign-in sub-flow row supplies, or HomeScreen', () => {
        const result = narrowRows(
            input({
                table: new Map([
                    ['recipes/a', new Set(['HomeScreen', 'login', 'RecipeVersionsScreen'])],
                    ['auth/signin', new Set(['HomeScreen', 'login'])],
                ]),
                android: new Map([['recipes/a', observed(['HomeScreen', 'login', 'RecipeVersionsScreen'])]]),
                ios: new Map([['recipes/a', observed(['HomeScreen', 'login', 'RecipeVersionsScreen'])]]),
            }),
        );

        expect(removedOf(result).get('recipes/a')).toEqual(['RecipeVersionsScreen']);
    });

    it('does not narrow a sub-flow’s own row', () => {
        const result = narrowRows(
            input({
                suppliedBySubflows: () => new Set(),
                android: new Map([['auth/signin', observed(['login'])]]),
                ios: new Map([['auth/signin', observed(['login'])]]),
            }),
        );

        expect(removedOf(result).has('auth/signin')).toBe(false);
    });

    it('ignores a wider screen the row does not name (it came from a sub-flow)', () => {
        const result = narrowRows(
            input({
                android: new Map([['recipes/a', observed(['CompleteSignUpScreen'])]]),
                ios: new Map([['recipes/a', observed(['CompleteSignUpScreen'])]]),
            }),
        );

        expect(result.removed).toEqual([]);
    });
});

describe('narrowRows: screens a platform saw that the row lacks', () => {
    it('lists them as owed additions, from either platform, and does not add them itself', () => {
        const result = narrowRows(
            input({
                android: new Map([['recipes/a', observed(['RecipeVersionsScreen'], ['profile'])]]),
                ios: new Map([['recipes/a', observed(['RecipeVersionsScreen'], ['CollectionsScreen', 'profile'])]]),
            }),
        );

        expect(result.owedAdditions).toEqual([{ flow: 'recipes/a', screens: ['CollectionsScreen', 'profile'] }]);
        expect(result.table.get('recipes/a')?.has('profile')).toBe(false);
    });

    it('does not list a screen the row already names', () => {
        const result = narrowRows(input({ ios: new Map([['recipes/a', observed([], ['RecipeEditorScreen'])]]) }));

        expect(result.owedAdditions).toEqual([]);
    });
});

describe('renderTable', () => {
    const text = lines(
        '# a comment, kept',
        'recipes/a\tHomeScreen, RecipeVersionsScreen, RecipeEditorScreen',
        'recipes/b\tHomeScreen, RecipeListScreen',
        '',
    );

    it('drops only the removed screens, keeps the order, the comments and the other rows', () => {
        expect(renderTable(text, new Map([['recipes/a', ['RecipeVersionsScreen']]]))).toBe(
            lines(
                '# a comment, kept',
                'recipes/a\tHomeScreen, RecipeEditorScreen',
                'recipes/b\tHomeScreen, RecipeListScreen',
                '',
            ),
        );
    });

    it('is the identity when nothing is removed', () => {
        expect(renderTable(text, new Map())).toBe(text);
    });
});
