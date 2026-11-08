import { describe, expect, it } from 'vitest';

import { evidenceOf, parseScreenEvidence, screenEvidence } from '../src/screenEvidence.js';
import type { ScreenCheck } from '../src/screenCheck.js';

const check: ScreenCheck = {
    missing: [{ flow: 'recipes/a', screens: ['profile'] }],
    silent: [],
    wider: [
        { flow: 'recipes/a', screens: ['RecipeVersionsScreen', 'login'], branching: false },
        { flow: 'recipes/b', screens: ['CollectionsScreen'], branching: true },
    ],
};
const results = new Map([
    ['recipes/a', 'passed' as const],
    ['recipes/b', 'passed' as const],
    ['recipes/c', 'failed' as const],
]);

describe('screenEvidence', () => {
    it('keeps, for every flow with a result, the screens its row was wider than and the screens it lacked', () => {
        expect(screenEvidence('android', check, results)).toEqual({
            version: 1,
            platform: 'android',
            flows: [
                { flow: 'recipes/a', result: 'passed', wider: ['RecipeVersionsScreen', 'login'], added: ['profile'] },
                { flow: 'recipes/b', result: 'passed', wider: ['CollectionsScreen'], added: [] },
                { flow: 'recipes/c', result: 'failed', wider: [], added: [] },
            ],
        });
    });

    it('round-trips through JSON text, so the recorder and the narrowing agree on the shape', () => {
        const text = JSON.stringify(screenEvidence('ios', check, results));

        expect(parseScreenEvidence(text, 'ios.json')).toEqual(screenEvidence('ios', check, results));
    });

    it.each([
        ['text that is not JSON', 'nope'],
        ['a report of another version', JSON.stringify({ version: 2, platform: 'ios', flows: [] })],
        [
            'a flow with an unknown result',
            JSON.stringify({
                version: 1,
                platform: 'ios',
                flows: [{ flow: 'a', result: 'maybe', wider: [], added: [] }],
            }),
        ],
        [
            'a flow whose screens are not strings',
            JSON.stringify({
                version: 1,
                platform: 'ios',
                flows: [{ flow: 'a', result: 'passed', wider: [1], added: [] }],
            }),
        ],
    ])('refuses %s, naming the file', (_name, text) => {
        expect(() => parseScreenEvidence(text, 'ios.json')).toThrow(/ios\.json/u);
    });

    it('reads a report as per-flow observations for the narrowing', () => {
        const evidence = evidenceOf(screenEvidence('android', check, results));

        expect(evidence.get('recipes/a')).toEqual({
            result: 'passed',
            wider: new Set(['RecipeVersionsScreen', 'login']),
            added: new Set(['profile']),
        });
        expect(evidence.get('recipes/c')?.result).toBe('failed');
    });
});
