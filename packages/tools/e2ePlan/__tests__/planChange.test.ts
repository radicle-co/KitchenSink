import { describe, expect, it, vi } from 'vitest';

import { planChange, type TierModel } from '../src/planChange.js';
import type { Reached } from '../src/reachability.js';

const reached = (parts: Partial<{ screens: string[]; tests: string[]; roots: string[] }> = {}): Reached => ({
    screens: new Set(parts.screens ?? []),
    tests: new Set(parts.tests ?? []),
    roots: parts.roots ?? [],
});

const model = (
    name: TierModel['name'],
    reachByFile: Readonly<Record<string, Reached>>,
    problems: readonly string[] = [],
): TierModel => ({
    name,
    screens: ['/a', '/b'],
    tests: ['a.spec', 'b.spec'],
    coverage: new Map([
        ['a.spec', new Set(['/a'])],
        ['b.spec', new Set(['/b'])],
    ]),
    reachFile: (file) => reachByFile[file],
    problems,
});

const load = (web: TierModel, mobile: TierModel) => vi.fn(async () => ({ web, mobile }));
const empty = reached();

describe('planChange', () => {
    it('selects nothing for documentation only, without building any graph', async () => {
        const loader = load(model('web', {}), model('mobile', {}));
        const plan = await planChange(['docs/a.md', 'specs/001/spec.md', 'README.md'], loader, { fullSuite: false });

        expect(plan.web).toEqual({ kind: 'some', picks: [] });
        expect(plan.mobile).toEqual({ kind: 'some', picks: [] });
        expect(loader).not.toHaveBeenCalled();
    });

    it('selects the whole suite for a service change, without building any graph', async () => {
        const loader = load(model('web', {}), model('mobile', {}));
        const plan = await planChange(['packages/services/recipe/src/x.ts'], loader, { fullSuite: false });

        expect(plan.web.kind).toBe('all');
        expect(plan.mobile.kind).toBe('all');
        expect(loader).not.toHaveBeenCalled();
    });

    it('selects the whole suite for no change that it can name when FULL_SUITE is set', async () => {
        const plan = await planChange([], load(model('web', {}), model('mobile', {})), { fullSuite: true });

        expect(plan.web).toEqual({ kind: 'all', reasons: ['FULL_SUITE=1'] });
    });

    it('selects only what a screen change reaches, per tier', async () => {
        const plan = await planChange(
            ['src/leaf.tsx'],
            load(
                model('web', { 'src/leaf.tsx': reached({ screens: ['/a'] }) }),
                model('mobile', { 'src/leaf.tsx': empty }),
            ),
            { fullSuite: false },
        );

        expect(plan.web).toEqual({ kind: 'some', picks: [{ id: 'a.spec', because: 'src/leaf.tsx reaches /a' }] });
        expect(plan.mobile).toEqual({ kind: 'some', picks: [] });
    });

    it('treats a file in neither tier graph as unreached, which widens both tiers', async () => {
        const plan = await planChange(['src/stray.ts'], load(model('web', {}), model('mobile', {})), {
            fullSuite: false,
        });

        expect(plan.web.kind).toBe('all');
        expect(plan.mobile.kind).toBe('all');
    });

    it('treats a file both graphs hold but nothing reaches as unreached', async () => {
        const plan = await planChange(
            ['src/dead.ts'],
            load(model('web', { 'src/dead.ts': empty }), model('mobile', { 'src/dead.ts': empty })),
            { fullSuite: false },
        );

        expect(plan.web.kind).toBe('all');
    });

    it('does not widen the web tier for a mobile-only file', async () => {
        const plan = await planChange(
            ['src/Thing.native.tsx'],
            load(model('web', {}), model('mobile', { 'src/Thing.native.tsx': reached({ screens: ['/b'] }) })),
            { fullSuite: false },
        );

        expect(plan.web).toEqual({ kind: 'some', picks: [] });
        expect(plan.mobile).toEqual({
            kind: 'some',
            picks: [{ id: 'b.spec', because: 'src/Thing.native.tsx reaches /b' }],
        });
    });

    it('widens a tier whose graph is incomplete, and says why, once a graph was needed', async () => {
        const plan = await planChange(
            ['src/leaf.tsx'],
            load(
                model('web', { 'src/leaf.tsx': reached({ screens: ['/a'] }) }, [
                    'x.tsx imports @fx/y, which the graph cannot follow',
                ]),
                model('mobile', { 'src/leaf.tsx': reached({ screens: ['/a'] }) }),
            ),
            { fullSuite: false },
        );

        expect(plan.web).toEqual({
            kind: 'all',
            reasons: ['import graph incomplete: x.tsx imports @fx/y, which the graph cannot follow'],
        });
        expect(plan.mobile.kind).toBe('some');
    });

    it('falls back to the whole suite, with a warning, when building the models throws', async () => {
        const plan = await planChange(['src/leaf.tsx'], async () => Promise.reject(new Error('boom')), {
            fullSuite: false,
        });

        expect(plan.web.kind).toBe('all');
        expect(plan.mobile.kind).toBe('all');
        expect(plan.warnings.join('\n')).toContain('boom');
    });

    it('keeps the reasons a path alone settled when the models cannot be built', async () => {
        const plan = await planChange(
            ['package-lock.json', 'src/leaf.tsx'],
            async () => Promise.reject(new Error('boom')),
            {
                fullSuite: false,
            },
        );

        expect(plan.web).toEqual({
            kind: 'all',
            reasons: ['package-lock.json: root configuration', 'the selector could not build its model: boom'],
        });
    });

    it('lets a test-file change select that test', async () => {
        const plan = await planChange(
            ['src/a.spec.ts'],
            load(model('web', { 'src/a.spec.ts': reached({ tests: ['a.spec'] }) }), model('mobile', {})),
            { fullSuite: false },
        );

        expect(plan.web).toEqual({ kind: 'some', picks: [{ id: 'a.spec', because: 'src/a.spec.ts is part of it' }] });
    });
});
