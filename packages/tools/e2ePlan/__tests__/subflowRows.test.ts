import { describe, expect, it } from 'vitest';

import { rowedHelperFiles } from '../src/branchingFlows.js';
import { namedScreens, subflowRowViolations, type SubflowEntry } from '../src/subflowRows.js';

const SCREENS = ['HomeScreen', 'RecipeListScreen', 'RecipeEditorScreen', 'login', 'profile', 'signup'];

describe('namedScreens: what a helper’s text says it reaches', () => {
    it('reads a screen module path and a Screen name, and nothing that is not a registry screen', () => {
        const text = [
            '# The login form lives in mobile/src/screens/login.tsx; the session renders HomeScreen.',
            '# A RecipeWidget and a NotAScreen are not screens. Neither is the word profile on its own.',
        ].join('\n');

        expect(namedScreens(text, SCREENS)).toEqual(new Set(['login', 'HomeScreen']));
    });

    it('reads a native module path too', () => {
        expect(namedScreens('# see src/screens/RecipeEditorScreen.native.tsx', SCREENS)).toEqual(
            new Set(['RecipeEditorScreen']),
        );
    });
});

const entry = (over: Partial<SubflowEntry> = {}): SubflowEntry => ({
    id: 'auth/signOutIfSignedIn',
    row: new Set(['HomeScreen', 'login', 'profile']),
    text: '# lands on HomeScreen after the sign out',
    childRows: [],
    ...over,
});

describe('subflowRowViolations', () => {
    it('passes a helper whose row holds everything its text names and its helpers’ rows hold', () => {
        expect(subflowRowViolations([entry()], SCREENS)).toEqual([]);
    });

    it('fails a helper whose text names a screen its row lacks', () => {
        const result = subflowRowViolations([entry({ text: '# ends in mobile/src/screens/signup.tsx' })], SCREENS);

        expect(result).toEqual([{ id: 'auth/signOutIfSignedIn', missing: ['signup'], because: 'its text names them' }]);
    });

    it('fails a helper whose row lacks a screen a helper it runs reaches', () => {
        const result = subflowRowViolations(
            [entry({ row: new Set(['HomeScreen']), childRows: [new Set(['login', 'HomeScreen'])] })],
            SCREENS,
        );

        expect(result).toEqual([
            { id: 'auth/signOutIfSignedIn', missing: ['login'], because: 'a helper it runs reaches them' },
        ]);
    });

    it('names both causes when both apply', () => {
        const result = subflowRowViolations(
            [entry({ row: new Set(['HomeScreen']), text: '# screens/signup.tsx', childRows: [new Set(['login'])] })],
            SCREENS,
        );

        expect(result.map((violation) => violation.because).sort()).toEqual([
            'a helper it runs reaches them',
            'its text names them',
        ]);
    });
});

describe('subflowRowViolations: a helper with an empty row', () => {
    const empty = (text: string): SubflowEntry => ({
        id: 'recipes/common/scroll',
        row: new Set(),
        text,
        childRows: [],
    });

    it('passes when its text names no screen: it acts on its caller’s screen', () => {
        expect(subflowRowViolations([empty('- scrollUntilVisible: Save')], SCREENS)).toEqual([]);
    });

    it('fails when its text names a screen, because then it does reach one', () => {
        expect(subflowRowViolations([empty('# ends on mobile/src/screens/login.tsx')], SCREENS)).toEqual([
            { id: 'recipes/common/scroll', missing: ['login'], because: 'its text names them' },
        ]);
    });

    it('fails when a helper it runs reaches a screen', () => {
        const entry = { ...empty('- runFlow: signin.yaml'), childRows: [new Set(['login'])] };

        expect(subflowRowViolations([entry], SCREENS)).toHaveLength(1);
    });
});

describe('rowedHelperFiles', () => {
    it('names the files of the rows that are not top-level flows', () => {
        const table = new Map([
            ['recipes/a', new Set(['HomeScreen'])],
            ['auth/signin', new Set(['HomeScreen'])],
        ]);
        const tests = new Map([['maestro/recipes/a.yaml', 'recipes/a']]);

        expect(rowedHelperFiles(table, tests, (id) => `maestro/${id}.yaml`)).toEqual(
            new Set(['maestro/auth/signin.yaml']),
        );
    });
});
