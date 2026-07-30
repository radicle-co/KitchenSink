/**
 * Test fixture: a fake {@link VersionsService} for unit-testing {@link RecipesService} in isolation.
 *
 * RecipesService records a version snapshot on every write via VersionsService (a forwardRef circular
 * dependency). Unit tests that exercise create/update/clone construct the service with this stub so they
 * neither hit a real DB/S3 nor swallow an undefined-dependency error — and can assert `createSnapshot`
 * was (or was not) called.
 */
import { vi } from 'vitest';

import type { VersionsService } from '../../versions/versions.service.js';

/** A VersionsService stub whose `createSnapshot` is a resolved spy. Cast structurally (test-only). */
export function makeFakeVersionsService(): VersionsService {
    return {
        createSnapshot: vi.fn().mockResolvedValue(undefined),
    } as unknown as VersionsService;
}
