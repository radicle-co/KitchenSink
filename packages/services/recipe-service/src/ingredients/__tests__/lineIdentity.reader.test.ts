/**
 * `LineIdentityReader` — the ONE place a recipe line's bindings are turned into identities (plan 002 R9, R10):
 * food is asked once, in one batch, about every bound arm, and each arm's identity is derived from its answer.
 * The write planner and the detail assembler both read names through it, so the two cannot name a line
 * differently.
 */
import { describe, expect, it, vi } from 'vitest';

import type { FoodLookupArm } from '../../database/schema/foodLookupArm.js';
import type { FoodLookupsDal } from '../dal/foodLookups.dal.js';
import { canonicalIngredientName } from '../domain/ingredientName.js';
import type { FoodRefsGateway } from '../foodRefs.gateway.js';
import { LineIdentityReader } from '../lineIdentity.reader.js';

const AT = new Date('2026-09-30T00:00:00.000Z');
const ROOT: FoodLookupArm = { kind: 'root', lookupId: 'l-root', foodId: 'food-1', foodOwnerId: null, createdAt: AT };
const VARIANT: FoodLookupArm = { kind: 'variant', lookupId: 'l-variant', foodVariantId: 'var-1', createdAt: AT };
const DECLARED: FoodLookupArm = {
    kind: 'unresolved',
    lookupId: 'l-declared',
    createdAt: AT,
    failure: {
        unresolvedFoodId: 'f1',
        name: 'grandma’s spice mix',
        normalizedKey: 'grandma’s spice mix',
        reasonCode: 'author_declared',
        status: 'UNRESOLVED',
        foodHandleId: null,
        tiersConsulted: [],
        tiersUnavailable: [],
        attempts: 1,
        settledLookupId: null,
    },
};

function build(arms: readonly FoodLookupArm[], names: Record<string, string> = {}) {
    const findByIds = vi.fn().mockResolvedValue(new Map(arms.map((arm) => [arm.lookupId, arm])));
    const resolve = vi.fn(async (_caller: unknown, refs: readonly { kind: string; id: string }[]) => ({
        answers: new Map(
            refs.map((ref) => {
                const name = names[`${ref.kind}:${ref.id}`];

                return [
                    `${ref.kind}:${ref.id}`,
                    name === undefined
                        ? { outcome: 'unreachable' }
                        : {
                              outcome: 'found',
                              name: canonicalIngredientName(name),
                              status: 'RESOLVED',
                              isPrivate: false,
                          },
                ];
            }),
        ),
        degraded: false,
    }));

    return {
        reader: new LineIdentityReader(
            { findByIds } as unknown as FoodLookupsDal,
            {
                resolve,
            } as unknown as FoodRefsGateway,
        ),
        findByIds,
        resolve,
    };
}

describe('LineIdentityReader.identifyArms', () => {
    it('asks food ONCE, in one batch, about every bound arm — a root and a variant by their own kinds', async () => {
        const { reader, resolve } = build([], { 'root:food-1': 'beef brisket', 'variant:var-1': 'flat-cut brisket' });

        const identities = await reader.identifyArms(
            undefined,
            new Map<string, FoodLookupArm>([
                ['l-root', ROOT],
                ['l-variant', VARIANT],
                ['l-declared', DECLARED],
            ]),
            'read',
        );

        expect(resolve).toHaveBeenCalledTimes(1);
        expect(resolve).toHaveBeenCalledWith(
            undefined,
            [
                { kind: 'root', id: 'food-1' },
                { kind: 'variant', id: 'var-1' },
            ],
            'read',
        );
        expect(identities.get('l-root')?.name).toBe('beef brisket');
        expect(identities.get('l-variant')?.name).toBe('flat-cut brisket');
        expect(identities.get('l-declared')?.name).toBe('grandma’s spice mix');
    });

    it('asks food nothing when no arm is bound', async () => {
        const { reader, resolve } = build([]);

        const identities = await reader.identifyArms(undefined, new Map([['l-declared', DECLARED]]), 'read');

        expect(resolve).not.toHaveBeenCalled();
        expect(identities.get('l-declared')?.presence).toBe('unbound');
    });

    it('⛔ leaves a bound arm nameless and unreachable when food cannot be asked — never a stale name', async () => {
        const { reader } = build([]);

        const identities = await reader.identifyArms(undefined, new Map([['l-root', ROOT]]), 'read');

        expect(identities.get('l-root')).toMatchObject({ name: undefined, presence: 'unreachable' });
    });
});

describe('LineIdentityReader.identify — stored bindings by id', () => {
    it('loads the arms, then derives identities under the budget asked for', async () => {
        const { reader, findByIds, resolve } = build([ROOT], { 'root:food-1': 'beef brisket' });

        const identities = await reader.identify(undefined, ['l-root'], 'postCommit');

        expect(findByIds).toHaveBeenCalledWith(['l-root']);
        expect(resolve).toHaveBeenCalledWith(undefined, [{ kind: 'root', id: 'food-1' }], 'postCommit');
        expect(identities.get('l-root')?.name).toBe('beef brisket');
    });

    it('omits a binding that no longer exists', async () => {
        const { reader } = build([]);

        expect((await reader.identify(undefined, ['l-gone'], 'read')).has('l-gone')).toBe(false);
    });
});
