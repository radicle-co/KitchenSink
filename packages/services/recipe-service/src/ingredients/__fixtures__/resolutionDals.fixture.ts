/**
 * Doubles for the three resolution-side collaborators `RecipesService` requires.
 *
 * ⛔ They are REQUIRED on the constructor, which is why these exist. An optional collaborator means a null
 * branch per site that production never reaches and only under-specified suites rely on — and it is how a
 * feature goes silently absent past a green suite (a consumer that exists while nothing sends it a message).
 *
 * A suite that does not care about resolution provenance passes these; a suite that does overrides the one
 * method it asserts on.
 */
import { vi } from 'vitest';

import type { IngredientResolutionsDal, LatestResolution } from '../resolution/ingredientResolutions.dal.js';
import type { ResolutionBandsDal } from '../resolution/resolutionBands.dal.js';
import type { VerificationRedriveDal } from '../resolution/verificationRedrive.dal.js';

/**
 * A resolutions DAL that has no events — the shape a fresh database has.
 *
 * @param overrides - Methods a suite asserts on.
 * @returns The double.
 */
export function makeFakeIngredientResolutionsDal(
    overrides: Partial<IngredientResolutionsDal> = {},
): IngredientResolutionsDal {
    return {
        latestResolutionsByIngredientIds: vi.fn().mockResolvedValue(new Map<string, LatestResolution>()),
        ...overrides,
    } as unknown as IngredientResolutionsDal;
}

/**
 * A bands DAL that grants no authority, so every line verifies — the safe direction.
 *
 * @param overrides - Methods a suite asserts on.
 * @returns The double.
 */
export function makeFakeResolutionBandsDal(overrides: Partial<ResolutionBandsDal> = {}): ResolutionBandsDal {
    return {
        authorityFor: vi.fn().mockResolvedValue(undefined),
        observationsSinceGrant: vi.fn().mockResolvedValue(0),
        recordSkip: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as unknown as ResolutionBandsDal;
}

/**
 * A redrive DAL that accepts every write — without it a withholding line simply is not re-drivable, which
 * is a fact about the drain, not about the save under test.
 *
 * @param overrides - Methods a suite asserts on.
 * @returns The double.
 */
export function makeFakeVerificationRedriveDal(
    overrides: Partial<VerificationRedriveDal> = {},
): VerificationRedriveDal {
    return {
        record: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as unknown as VerificationRedriveDal;
}
