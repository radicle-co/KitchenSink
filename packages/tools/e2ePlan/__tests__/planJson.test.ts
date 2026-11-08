import { describe, expect, it } from 'vitest';

import { parsePlanJson, tierLines, toPlanJson, type PlanMeta } from '../src/planJson.js';
import type { Plan } from '../src/selection.js';

const plan: Plan = {
    web: { kind: 'some', picks: [{ id: 'a.spec.ts', because: 'x reaches /a' }] },
    mobile: { kind: 'all', reasons: ['package-lock.json: root configuration'] },
    warnings: ['careful'],
};

const ref: PlanMeta = { base: { kind: 'ref', ref: 'origin/main' }, treeAtStart: 'tree1', previous: null };

describe('toPlanJson and parsePlanJson', () => {
    it('round-trips a plan: a tier that runs some carries its ids, and one that runs all carries its reasons', () => {
        expect(parsePlanJson(toPlanJson(plan, ref))).toEqual({
            web: { kind: 'some', ids: ['a.spec.ts'] },
            mobile: { kind: 'all', reasons: ['package-lock.json: root configuration'] },
            warnings: ['careful'],
            ...ref,
        });
    });

    it.each<[string, PlanMeta]>([
        [
            'a stamp, with the flows still owed',
            { base: { kind: 'stamp', tree: 't0', owed: ['a/b'] }, treeAtStart: 't1', previous: null },
        ],
        [
            'no base, with the reason',
            { base: { kind: 'none', reason: 'no green run' }, treeAtStart: null, previous: null },
        ],
    ])('carries %s', (_name, meta) => {
        expect(parsePlanJson(toPlanJson(plan, meta))).toMatchObject(meta);
    });

    it('refuses a plan with no base, so a reader never guesses what it was measured from', () => {
        const { base: _base, ...rest } = JSON.parse(toPlanJson(plan, ref)) as Record<string, unknown>;

        expect(() => parsePlanJson(JSON.stringify(rest))).toThrow(/base/u);
    });

    it('keeps an empty list of ids, which means run none, apart from run all', () => {
        const none: Plan = { web: { kind: 'some', picks: [] }, mobile: { kind: 'some', picks: [] }, warnings: [] };

        expect(parsePlanJson(toPlanJson(none, ref)).web).toEqual({ kind: 'some', ids: [] });
    });

    it.each([
        ['text that is not JSON', 'nope'],
        ['an object with no tiers', '{}'],
        [
            'a tier of an unknown kind',
            JSON.stringify({ ...ref, web: { kind: 'most' }, mobile: { kind: 'all', reasons: [] }, warnings: [] }),
        ],
        [
            'a some-tier with no ids',
            JSON.stringify({ ...ref, web: { kind: 'some' }, mobile: { kind: 'all', reasons: [] }, warnings: [] }),
        ],
        [
            'ids that are not strings',
            JSON.stringify({
                ...ref,
                web: { kind: 'some', ids: [1] },
                mobile: { kind: 'all', reasons: [] },
                warnings: [],
            }),
        ],
    ])('refuses %s, so a half-read plan is never taken for "run nothing"', (_name, text) => {
        expect(() => parsePlanJson(text)).toThrow();
    });
});

describe('tierLines', () => {
    it('says `all` alone for a tier that runs everything: there is no list to read', () => {
        expect(tierLines({ kind: 'all', reasons: ['x'] })).toBe('all\n');
    });

    it('says `some` and then one id per line, in the order given', () => {
        expect(tierLines({ kind: 'some', ids: ['recipes/create', 'home'] })).toBe('some\nrecipes/create\nhome\n');
    });

    it('says `some` alone for a tier that runs none, which is not the same as `all`', () => {
        expect(tierLines({ kind: 'some', ids: [] })).toBe('some\n');
    });
});
