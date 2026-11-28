/**
 * The ways-out policy (heldPublicSave U2, KTD-1, AE4 pre-U6 shape, AE8). One table row per door and slot standing, each
 * crossed with a rewrite offered or not, asserting the exact ordered ways and lines.
 */
import { describe, expect, it } from 'vitest';

import { CAUSES } from '../__fixtures__/describeRewriteWayContract.js';
import { waysOutOf, type WaysOutFacts } from '../waysOut.js';
import type { RewriteWayAnswer } from '../rewriteWay.js';

const NOT_OFFERED: RewriteWayAnswer = { kind: 'unavailable' };
const OFFERED: RewriteWayAnswer = { kind: 'available', wayLineKey: 'keepPublicInOwnWords' };
const REWRITE = { kind: 'rewrite', wayLineKey: 'keepPublicInOwnWords' } as const;

function facts(over: Partial<WaysOutFacts> = {}): WaysOutFacts {
    return {
        cause: { kind: 'heldSource' },
        door: 'save',
        slots: 'free',
        plan: 'pro',
        subscriptionEntryPointsOn: false,
        rewrite: NOT_OFFERED,
        ...over,
    };
}

describe('waysOutOf, save door', () => {
    it.each([
        ['free slot, no rewrite', facts(), [{ kind: 'discard' }, { kind: 'makePrivate' }], []],
        [
            'free slot, rewrite offered',
            facts({ rewrite: OFFERED }),
            [REWRITE, { kind: 'discard' }, { kind: 'makePrivate' }],
            [],
        ],
        ['no slot, no rewrite', facts({ slots: 'none' }), [{ kind: 'discard' }], ['slotsFull']],
        [
            'no slot, rewrite offered',
            facts({ slots: 'none', rewrite: OFFERED }),
            [REWRITE, { kind: 'discard' }],
            ['slotsFull'],
        ],
    ])('%s', (_name, input, ways, lines) => {
        expect(waysOutOf(input)).toStrictEqual({ ways, lines });
    });

    it('never offers Make private without a free slot', () => {
        const { ways } = waysOutOf(facts({ slots: 'none', rewrite: OFFERED }));
        expect(ways.some((way) => way.kind === 'makePrivate')).toBe(false);
    });

    it('keeps Discard on every save-door row', () => {
        for (const slots of ['free', 'none'] as const) {
            for (const rewrite of [NOT_OFFERED, OFFERED]) {
                expect(waysOutOf(facts({ slots, rewrite })).ways).toContainEqual({ kind: 'discard' });
            }
        }
    });
});

describe('waysOutOf, publish door (AE8)', () => {
    it.each([
        ['free slot, no rewrite', facts({ door: 'publish' }), [{ kind: 'publishPrivate' }], []],
        [
            'free slot, rewrite offered',
            facts({ door: 'publish', rewrite: OFFERED }),
            [REWRITE, { kind: 'publishPrivate' }],
            [],
        ],
        [
            'no slot, rewrite offered',
            facts({ door: 'publish', slots: 'none', rewrite: OFFERED }),
            [REWRITE],
            ['draftKept', 'slotsFull'],
        ],
    ])('%s', (_name, input, ways, lines) => {
        expect(waysOutOf(input)).toStrictEqual({ ways, lines });
    });

    it('no slot and no rewrite: an empty set that keeps the draft, and is valid', () => {
        expect(waysOutOf(facts({ door: 'publish', slots: 'none' }))).toStrictEqual({
            ways: [],
            lines: ['draftKept', 'slotsFull'],
        });
    });

    it('never offers Discard', () => {
        for (const slots of ['free', 'none'] as const) {
            for (const rewrite of [NOT_OFFERED, OFFERED]) {
                const { ways } = waysOutOf(facts({ door: 'publish', slots, rewrite }));
                expect(ways.some((way) => way.kind === 'discard')).toBe(false);
            }
        }
    });
});

describe('the Pro line', () => {
    const doors = ['save', 'publish'] as const;

    it.each(doors)('shows for a free cook when the entry points are on, %s door, last', (door) => {
        const { lines } = waysOutOf(facts({ door, plan: 'free', subscriptionEntryPointsOn: true, slots: 'none' }));
        expect(lines.at(-1)).toBe('pro');
    });

    it.each(doors)('is absent when the entry points are off, %s door', (door) => {
        expect(waysOutOf(facts({ door, plan: 'free', subscriptionEntryPointsOn: false })).lines).not.toContain('pro');
    });

    it.each(doors)('is absent for a Pro cook with the entry points on, %s door', (door) => {
        expect(waysOutOf(facts({ door, plan: 'pro', subscriptionEntryPointsOn: true })).lines).not.toContain('pro');
    });

    it.each(doors)('shows on a FREE-slot row for a free cook, exactly, %s door', (door) => {
        const { lines } = waysOutOf(facts({ door, slots: 'free', plan: 'free', subscriptionEntryPointsOn: true }));
        expect(lines).toStrictEqual(['pro']);
    });

    it('is never counted as a way', () => {
        const { ways } = waysOutOf(facts({ plan: 'free', subscriptionEntryPointsOn: true }));
        expect(ways).toStrictEqual([{ kind: 'discard' }, { kind: 'makePrivate' }]);
    });
});

describe('the rewrite way', () => {
    it('carries the answer line key and link through', () => {
        const rewrite: RewriteWayAnswer = {
            kind: 'available',
            wayLineKey: 'keepPublicInOwnWords',
            link: { href: 'https://example.com/', host: 'example.com' },
        };
        expect(waysOutOf(facts({ rewrite })).ways[0]).toStrictEqual({
            kind: 'rewrite',
            wayLineKey: 'keepPublicInOwnWords',
            link: { href: 'https://example.com/', host: 'example.com' },
        });
    });

    it('offers the same ways for every cause kind (the cause is an input, not a branch yet)', () => {
        const [first, ...rest] = CAUSES.map((cause) => waysOutOf(facts({ cause, rewrite: OFFERED })));

        for (const other of rest) {
            expect(other).toStrictEqual(first);
        }
    });
});
