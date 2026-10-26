/**
 * The double for the resolution-side collaborator `IngredientsService` requires: the event log (ADR-0071 removed the
 * band-authority one with the ranked event it served).
 *
 * ⛔ They are REQUIRED on the constructor, which is why these exist. An optional collaborator means a null
 * branch per site that production never reaches and only under-specified suites rely on — and it is how a
 * feature goes silently absent past a green suite (a consumer that exists while nothing sends it a message).
 *
 * A suite that does not care about resolution provenance passes these; a suite that does overrides the one
 * method it asserts on.
 */
import { vi } from 'vitest';

import type { IngredientResolutionsDal } from '../resolution/ingredientResolutions.dal.js';

/**
 * A resolutions DAL that has no events — the shape a fresh database has.
 *
 * ⛔ EVERY METHOD THE SERVICE CALLS MUST BE HERE, and the `as unknown as` cast is why that has to be said
 * rather than left to the compiler. The cast erases the difference between this object and the real DAL, so
 * when `record` was added to the DAL and `IngredientsService` began calling it, nothing failed to compile —
 * the gap surfaced at RUNTIME as `TypeError: this.resolutions.record is not a function`, swallowed into a
 * `warn` by the caller's catch, which then made every resolution silently unrecorded while the suites that
 * use this double stayed green.
 *
 * ⚠️ The cast cannot simply be dropped: a `Partial` spread over a class type is not assignable to it, and
 * the honest alternative — listing every method — is what this does for the one the service calls.
 *
 * @param overrides - Methods a suite asserts on.
 * @returns The double.
 */
export function makeFakeIngredientResolutionsDal(
    overrides: Partial<IngredientResolutionsDal> = {},
): IngredientResolutionsDal {
    return {
        record: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as unknown as IngredientResolutionsDal;
}
