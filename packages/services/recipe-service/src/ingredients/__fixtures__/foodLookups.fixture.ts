/**
 * Fixture factories for recipe-line bindings (`food_lookups` arms), and a bindings repository double that answers
 * exactly the arms a test names (`make*` accepting `Partial<T>`, per CODING_STANDARDS).
 */
import { vi } from 'vitest';

import type {
    FailureFacts,
    FoodLookupArm,
    RootArm,
    UnresolvedArm,
    VariantArm,
} from '../../database/schema/foodLookupArm.js';
import type { FoodLookupsDal } from '../dal/foodLookups.dal.js';

/** A stable creation time, so equality assertions are deterministic. */
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

/** A binding to a shared root food. Pass `foodOwnerId` for a private authored food. */
export function makeRootArm(overrides: Partial<RootArm> = {}): RootArm {
    return {
        kind: 'root',
        lookupId: '00000000-0000-4000-8000-0000000000ff',
        foodId: '01JFIXTUREFOOD000000000001',
        foodOwnerId: null,
        createdAt: CREATED_AT,
        ...overrides,
    };
}

/** A binding to a variant of a root. */
export function makeVariantArm(overrides: Partial<VariantArm> = {}): VariantArm {
    return {
        kind: 'variant',
        lookupId: '00000000-0000-4000-8000-0000000000fe',
        foodVariantId: '01JFIXTUREVARIANT000000001',
        createdAt: CREATED_AT,
        ...overrides,
    };
}

/**
 * A binding to a failure record. Defaults to a name the cook declared; pass `failure` fields for any other reason.
 */
export function makeUnresolvedArm(
    overrides: Partial<Omit<UnresolvedArm, 'failure'>> & { readonly failure?: Partial<FailureFacts> } = {},
): UnresolvedArm {
    const { failure, ...arm } = overrides;
    const name = failure?.name ?? 'Grandma’s spice mix';

    return {
        kind: 'unresolved',
        lookupId: '00000000-0000-4000-8000-0000000000fd',
        createdAt: CREATED_AT,
        ...arm,
        failure: {
            unresolvedFoodId: '00000000-0000-4000-8000-00000000fa11',
            name,
            normalizedKey: name.toLowerCase(),
            reasonCode: 'author_declared',
            status: 'UNRESOLVED',
            foodHandleId: null,
            tiersConsulted: [],
            tiersUnavailable: [],
            attempts: 1,
            settledLookupId: null,
            ...failure,
        },
    };
}

/**
 * A bindings repository double holding exactly `arms`: `findByIds` answers the known ids and leaves the rest out,
 * the same way the real repository answers a binding that does not exist.
 */
export function fakeFoodLookupsDal(...arms: readonly FoodLookupArm[]): FoodLookupsDal {
    const byId = new Map(arms.map((arm) => [arm.lookupId, arm]));

    return {
        findByIds: vi.fn((ids: readonly string[]) =>
            Promise.resolve(
                new Map(
                    ids.flatMap((id): [string, FoodLookupArm][] => {
                        const arm = byId.get(id);

                        return arm === undefined ? [] : [[id, arm]];
                    }),
                ),
            ),
        ),
    } as unknown as FoodLookupsDal;
}
