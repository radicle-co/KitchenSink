/**
 * Doubles for the three resolution-side collaborators `RecipesService` requires.
 *
 * ⛔ They are REQUIRED on the constructor, which is why these exist. They used to be optional, and the
 * service carried a null branch per site: production always supplied them, so those branches were
 * unreachable in a stage and load-bearing only for suites that had not thought about the collaborator. An
 * optional collaborator is how a feature goes silently absent past a green suite — the same failure U11
 * shipped, where the gate's consumer existed and nothing sent it a message.
 *
 * A suite that does not care about resolution provenance passes these; a suite that does overrides the one
 * method it asserts on.
 */
import { vi } from 'vitest';

import type { IngredientResolutionsDal, LatestResolution } from '../resolution/ingredientResolutions.dal.js';
import type { ResolutionBandsDal } from '../resolution/resolutionBands.dal.js';
import type { VerificationRedriveDal } from '../resolution/verificationRedrive.dal.js';

/**
 * A resolutions DAL that has no events — the shape a fresh database has, and what the removed `undefined`
 * branch used to stand in for.
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
 * A bands DAL that grants no authority, so every line verifies — the safe direction, and the one the
 * absent collaborator used to produce.
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
