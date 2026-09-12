/**
 * `decideRestoreLine` — what a version restore does with each line of the snapshot (plan 002 R52).
 *
 * A snapshot stores the line's binding id and the name the saving cook could share. At restore time the binding
 * may still stand, may point at a food that is gone or withdrawn, or may be gone itself. Every case is a row of
 * the table below, so a changed rule shows up as a changed row.
 */
import { describe, expect, it } from 'vitest';

import type { FoodLookupArm, UnresolvedArm } from '../../database/schema/foodLookupArm.js';
import type { FoodPresence, IngredientLineIdentity } from '../../ingredients/domain/ingredientLineIdentity.js';
import { canonicalIngredientName, type CanonicalIngredientName } from '../../ingredients/domain/ingredientName.js';
import { decideRestoreLine, type RestoreLineDecision, type SnapshotLineFacts } from '../domain/restoreLinePolicy.js';

const AT = new Date('2026-09-30T00:00:00.000Z');
const ROOT: FoodLookupArm = { kind: 'root', lookupId: 'l-root', foodId: 'food-1', foodOwnerId: null, createdAt: AT };
const VARIANT: FoodLookupArm = { kind: 'variant', lookupId: 'l-variant', foodVariantId: 'var-1', createdAt: AT };

function unresolved(reasonCode: UnresolvedArm['failure']['reasonCode']): UnresolvedArm {
    return {
        kind: 'unresolved',
        lookupId: 'l-unresolved',
        createdAt: AT,
        failure: {
            unresolvedFoodId: 'f1',
            name: 'Yuzu kosho',
            normalizedKey: 'yuzu kosho',
            reasonCode,
            status: reasonCode === 'author_declared' ? 'UNRESOLVED' : 'NOT_FOUND',
            foodHandleId: null,
            tiersConsulted: [],
            tiersUnavailable: [],
            attempts: 1,
            settledLookupId: null,
        },
    };
}

/** A name in canonical form, for an expected decision. */
function canonical(raw: string): CanonicalIngredientName {
    const name = canonicalIngredientName(raw);

    if (name === undefined) {
        throw new Error(`"${raw}" has no visible content`);
    }

    return name;
}

/** An identity as `deriveIngredientLineIdentity` would build it: a line food named carries its food. */
const bound = (arm: FoodLookupArm, presence: FoodPresence, name?: string): IngredientLineIdentity =>
    (presence === 'present' || presence === 'withdrawn') && name !== undefined
        ? { arm, name, presence, food: { rootId: arm.kind === 'root' ? arm.foodId : 'root-of-variant' } }
        : { arm, name, presence: presence === 'present' || presence === 'withdrawn' ? 'gone' : presence };
const line = (over: Partial<SnapshotLineFacts> = {}): SnapshotLineFacts => ({
    ingredientId: 'l-root',
    isUserEntered: false,
    ...over,
});

describe('decideRestoreLine — the binding still stands', () => {
    it.each<[string, SnapshotLineFacts, IngredientLineIdentity, RestoreLineDecision]>([
        [
            'a live bound food is restored exactly',
            line({ ingredientName: 'Beef brisket' }),
            bound(ROOT, 'present', 'Beef brisket'),
            { kind: 'reuse', lookupId: 'l-root' },
        ],
        [
            'a live variant is restored exactly',
            line({ ingredientId: 'l-variant', ingredientName: 'Flat-cut brisket' }),
            bound(VARIANT, 'present', 'Flat-cut brisket'),
            { kind: 'reuse', lookupId: 'l-variant' },
        ],
        [
            'a withdrawn food goes by the frozen name, to find what stands in for it now',
            line({ ingredientName: 'Beef brisket' }),
            bound(ROOT, 'withdrawn', 'Beef brisket'),
            { kind: 'byName', name: canonical('Beef brisket') },
        ],
        [
            'a food food no longer shows goes by the frozen name',
            line({ ingredientName: 'Beef brisket' }),
            bound(ROOT, 'gone'),
            { kind: 'byName', name: canonical('Beef brisket') },
        ],
        [
            '⛔ a gone food with NO frozen name keeps its binding, which renders honestly as removed',
            line(),
            bound(ROOT, 'gone'),
            { kind: 'reuse', lookupId: 'l-root' },
        ],
        [
            'a food that could not be asked about keeps its binding — an outage is not evidence it is gone',
            line({ ingredientName: 'Beef brisket' }),
            bound(ROOT, 'unreachable'),
            { kind: 'reuse', lookupId: 'l-root' },
        ],
        [
            'a declared line is restored exactly',
            line({ ingredientId: 'l-unresolved', ingredientName: 'Yuzu kosho', isUserEntered: true }),
            bound(unresolved('author_declared'), 'unbound', 'Yuzu kosho'),
            { kind: 'reuse', lookupId: 'l-unresolved' },
        ],
        [
            'any other unresolved line resolves its failure’s name again, which may succeed now',
            line({ ingredientId: 'l-unresolved' }),
            bound(unresolved('no_source_has_it'), 'unbound', 'Yuzu kosho'),
            { kind: 'byName', name: canonical('Yuzu kosho') },
        ],
    ])('%s', (_case, snapshotLine, identity, expected) => {
        expect(decideRestoreLine(snapshotLine, identity)).toStrictEqual(expected);
    });
});

describe('decideRestoreLine — the binding is gone', () => {
    it.each<[string, SnapshotLineFacts, RestoreLineDecision]>([
        [
            'a declared line is declared again under its frozen name',
            line({ ingredientName: 'Yuzu kosho', isUserEntered: true }),
            { kind: 'declare', name: canonical('Yuzu kosho') },
        ],
        [
            'any other line goes by its frozen name',
            line({ ingredientName: 'Beef brisket' }),
            { kind: 'byName', name: canonical('Beef brisket') },
        ],
        ['⛔ a line with no binding and no name cannot be restored', line(), { kind: 'unrestorable' }],
        [
            '⛔ a frozen name with no visible content counts as no name',
            line({ ingredientName: '   ' }),
            { kind: 'unrestorable' },
        ],
    ])('%s', (_case, snapshotLine, expected) => {
        expect(decideRestoreLine(snapshotLine, undefined)).toStrictEqual(expected);
    });
});
