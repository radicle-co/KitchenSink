import { describe, expect, it } from 'vitest';

import { parsePlanJson, toPlanJson } from '../src/planJson.js';
import type { Plan } from '../src/selection.js';

const plan: Plan = {
    web: { kind: 'some', picks: [{ id: 'a.spec.ts', because: 'x reaches /a' }] },
    mobile: { kind: 'all', reasons: ['package-lock.json: root configuration'] },
    warnings: ['careful'],
};

describe('toPlanJson and parsePlanJson', () => {
    it('round-trips a plan: a tier that runs some carries its ids, and one that runs all carries its reasons', () => {
        expect(parsePlanJson(toPlanJson(plan))).toEqual({
            web: { kind: 'some', ids: ['a.spec.ts'] },
            mobile: { kind: 'all', reasons: ['package-lock.json: root configuration'] },
            warnings: ['careful'],
        });
    });

    it('keeps an empty list of ids, which means run none, apart from run all', () => {
        const none: Plan = { web: { kind: 'some', picks: [] }, mobile: { kind: 'some', picks: [] }, warnings: [] };

        expect(parsePlanJson(toPlanJson(none)).web).toEqual({ kind: 'some', ids: [] });
    });

    it.each([
        ['text that is not JSON', 'nope'],
        ['an object with no tiers', '{}'],
        [
            'a tier of an unknown kind',
            JSON.stringify({ web: { kind: 'most' }, mobile: { kind: 'all', reasons: [] }, warnings: [] }),
        ],
        [
            'a some-tier with no ids',
            JSON.stringify({ web: { kind: 'some' }, mobile: { kind: 'all', reasons: [] }, warnings: [] }),
        ],
        [
            'ids that are not strings',
            JSON.stringify({ web: { kind: 'some', ids: [1] }, mobile: { kind: 'all', reasons: [] }, warnings: [] }),
        ],
    ])('refuses %s, so a half-read plan is never taken for "run nothing"', (_name, text) => {
        expect(() => parsePlanJson(text)).toThrow();
    });
});
