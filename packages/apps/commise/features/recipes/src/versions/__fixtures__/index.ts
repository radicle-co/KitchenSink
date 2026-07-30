/**
 * @module @commise/features-recipes/versions/__fixtures__ — `makeRecipeVersion` is the shared,
 * invariant-deriving Object Mother from `@kitchensink/recipe-core/testing` (T1) — re-exported here so the
 * version surface's tests (T069/T070) keep importing from this local module. `makeVersionConflictSide`
 * (W7) is local: it builds the 409's `server`/`base` side shape (`VersionConflictSide`), which has no
 * upstream Object Mother of its own.
 */
import { makeRecipeVersion } from '@kitchensink/recipe-core/testing';
import type { VersionConflictSide } from '@kitchensink/recipe-core';

export { makeRecipeVersion };

/**
 * Build a {@link VersionConflictSide} (a 409's `server`/`base` side, W8-a.5) with sensible defaults,
 * overridable per field. Defaults to carrying a `deviceLabel` (the common case the conflict banner's device
 * suffix renders); pass `{ deviceLabel: undefined }` to exercise the "no device known" banner variant.
 *
 * @param overrides - Fields to override on the default side.
 * @returns A complete `VersionConflictSide`.
 */
export function makeVersionConflictSide(overrides: Partial<VersionConflictSide> = {}): VersionConflictSide {
    const versionNumber = overrides.versionNumber ?? 6;

    return {
        versionNumber,
        deviceLabel: 'iPhone',
        updatedAt: '2026-05-09T14:30:00.000Z',
        snapshot: makeRecipeVersion({ versionNumber }).snapshot,
        ...overrides,
    };
}
