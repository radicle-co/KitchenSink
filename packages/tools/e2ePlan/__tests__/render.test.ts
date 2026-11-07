import { describe, expect, it } from 'vitest';

import { idsOf, renderPlan } from '../src/render.js';
import type { Plan } from '../src/selection.js';

const all = ['a.spec.ts', 'b.spec.ts', 'c.spec.ts'];

describe('idsOf', () => {
    it('returns every test for a whole-tier selection', () => {
        expect(idsOf({ kind: 'all', reasons: ['x'] }, all)).toEqual(all);
    });

    it('returns the picks, in the order the tier lists its tests', () => {
        const picks = [
            { id: 'c.spec.ts', because: '' },
            { id: 'a.spec.ts', because: '' },
        ];

        expect(idsOf({ kind: 'some', picks }, all)).toEqual(['a.spec.ts', 'c.spec.ts']);
    });

    it('refuses a pick the tier does not list, so a typo in a registry cannot shrink a run silently', () => {
        expect(() => idsOf({ kind: 'some', picks: [{ id: 'ghost.spec.ts', because: '' }] }, all)).toThrow(/ghost/u);
    });
});

const plan: Plan = {
    web: { kind: 'some', picks: [{ id: 'a.spec.ts', because: 'x.tsx reaches /a' }] },
    mobile: { kind: 'all', reasons: ['package-lock.json: root configuration', 'y.ts: not imported'] },
    warnings: ['the graph failed'],
};

describe('renderPlan', () => {
    const text = renderPlan(plan, { web: all, mobile: ['m1', 'm2'] }, { base: 'origin/main', changed: 5 });

    it('says how many of how many each tier runs, and why each pick runs', () => {
        expect(text).toContain('web (Playwright): 1 of 3');
        expect(text).toContain('a.spec.ts');
        expect(text).toContain('x.tsx reaches /a');
    });

    it('says a whole tier runs, and prints EVERY reason, not only the first', () => {
        expect(text).toContain('mobile (Maestro): all 2');
        expect(text).toContain('package-lock.json: root configuration');
        expect(text).toContain('y.ts: not imported');
    });

    it('prints warnings, and what the plan was measured against', () => {
        expect(text).toContain('warning: the graph failed');
        expect(text).toContain('origin/main');
        expect(text).toContain('5 changed');
    });

    it('says plainly that nothing runs when a tier selects nothing', () => {
        const none = renderPlan(
            { web: { kind: 'some', picks: [] }, mobile: { kind: 'some', picks: [] }, warnings: [] },
            { web: all, mobile: [] },
            { base: 'main', changed: 0 },
        );

        expect(none).toContain('web (Playwright): 0 of 3');
        expect(none).toContain('nothing to run');
    });

    it('shows the first reasons and counts the rest, so one lockfile change is not buried under a hundred files', () => {
        const reasons = Array.from({ length: 25 }, (_, index) => `file${index}.ts: not imported`);
        const text = renderPlan(
            { web: { kind: 'all', reasons }, mobile: { kind: 'some', picks: [] }, warnings: [] },
            { web: all, mobile: [] },
            { base: 'main', changed: 25 },
        );

        expect(text).toContain('file0.ts');
        expect(text).toContain('file9.ts');
        expect(text).not.toContain('file10.ts');
        expect(text).toContain('and 15 more');
    });
});
