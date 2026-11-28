import { describe, expectTypeOf, it, vi } from 'vitest';

import type { RecipesDal } from '../dal/recipes.dal.js';
import type { RecipesDalMembers } from '../__fixtures__/recipesDal.fixture.js';

/** `any`, without writing it: what `JSON.parse` answers. */
type AnyValue = ReturnType<typeof JSON.parse>;

/**
 * Pins the mapping `recipesDalDouble` relies on: a double member is the DAL's own type, and a member that would let a
 * wrong answer through is `never`. The assertions are type-level, so a later edit that loosens `RecipesDalMembers` to
 * `Partial<RecipesDal>` fails `npm run typecheck` here.
 */
describe('RecipesDalMembers', () => {
    it('maps a typed member to itself', () => {
        expectTypeOf<RecipesDalMembers<{ countPrivateSlots: RecipesDal['countPrivateSlots'] }>>().toEqualTypeOf<{
            countPrivateSlots: RecipesDal['countPrivateSlots'];
        }>();
    });

    it('maps a bare vi.fn() member (any return) to never', () => {
        expectTypeOf<RecipesDalMembers<{ create: ReturnType<typeof vi.fn> }>['create']>().toBeNever();
    });

    it('maps a () => any member to never', () => {
        expectTypeOf<RecipesDalMembers<{ create: () => AnyValue }>['create']>().toBeNever();
    });

    it('maps a () => Promise<AnyValue> member to never', () => {
        expectTypeOf<RecipesDalMembers<{ create: () => Promise<AnyValue> }>['create']>().toBeNever();
    });

    it('maps a member typed any to never', () => {
        expectTypeOf<RecipesDalMembers<{ create: AnyValue }>['create']>().toBeNever();
    });

    it('maps a key that is not a RecipesDal member to never', () => {
        expectTypeOf<RecipesDalMembers<{ notAMember: () => number }>['notAMember']>().toBeNever();
    });

    it('maps a non-function member to never', () => {
        expectTypeOf<RecipesDalMembers<{ create: number }>['create']>().toBeNever();
    });
});
