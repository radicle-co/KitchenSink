// @vitest-environment node
/**
 * The CI web selection (`scripts/e2eSelectCi.ts`), one test per branch.
 *
 * Every branch except "specs" widens to the whole suite, because a skipped test looks like a passed test. Each
 * widening case is a way the selection could quietly narrow, and it fails if it does.
 */
import { describe, expect, it, vi } from 'vitest';

import { selectWeb, type SelectDeps } from '../e2eSelectCi';

const test = (spec: string, title = 't') => ({
    id: `[own-session] › ${spec} › ${title}`,
    project: 'own-session',
    status: 'ok',
    durationMs: 1,
});

const deps = (overrides: Partial<SelectDeps>): SelectDeps => ({
    plan: () => Promise.resolve({ kind: 'all', reasons: ['r'] }),
    listSpecs: () => [],
    countAll: () => 56,
    ...overrides,
});

describe('selectWeb', () => {
    it('selects the named specs and counts only their tests', async () => {
        const selection = await selectWeb(
            deps({
                plan: () => Promise.resolve({ kind: 'some', ids: ['home.spec.ts'] }),
                listSpecs: () => [test('home.spec.ts', 'a'), test('home.spec.ts', 'b')],
            }),
        );

        expect(selection).toEqual({ kind: 'specs', filters: ['tests/e2e/home\\.spec\\.ts$'], tests: 2 });
    });

    it('selects nothing when no spec covers the change', async () => {
        const selection = await selectWeb(deps({ plan: () => Promise.resolve({ kind: 'some', ids: [] }) }));

        expect(selection).toEqual({ kind: 'none' });
    });

    it('runs the whole suite when the selector says all', async () => {
        expect(await selectWeb(deps({}))).toEqual({ kind: 'unselected', tests: 56 });
    });

    it('runs the whole suite when the selector throws', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const selection = await selectWeb(deps({ plan: () => Promise.reject(new Error('git failed')) }));

        expect(selection).toEqual({ kind: 'unselected', tests: 56 });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('git failed'));
        warn.mockRestore();
    });

    it('runs the whole suite when a chosen spec lists no test, rather than counting it as zero', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const selection = await selectWeb(
            deps({ plan: () => Promise.resolve({ kind: 'some', ids: ['ghost.spec.ts'] }), listSpecs: () => [] }),
        );

        expect(selection).toEqual({ kind: 'unselected', tests: 56 });
        warn.mockRestore();
    });

    it('runs the whole suite when the lister throws', async () => {
        const selection = await selectWeb(
            deps({
                plan: () => Promise.resolve({ kind: 'some', ids: ['home.spec.ts'] }),
                listSpecs: () => {
                    throw new Error('list failed');
                },
            }),
        );

        expect(selection).toEqual({ kind: 'unselected', tests: 56 });
    });
});
