import { describe, expect, it } from 'vitest';

import { isDesignArtifactError } from '../../errors.js';
import { assertDistinctNames } from '../assertDistinctNames.js';
import { makeSurfaceEntry } from '../__fixtures__/makeSurfaceEntry.js';

describe('assertDistinctNames', () => {
    it('returns the surface it was given when every name is unique per platform', () => {
        const surface = {
            web: [makeSurfaceEntry('Button', { file: '/a.tsx' })],
            native: [makeSurfaceEntry('Button', { file: '/a.native.tsx' })],
        };

        expect(assertDistinctNames(surface)).toBe(surface);
    });

    it.each(['web', 'native'] as const)(
        'throws duplicate-name for a repeat on the %s surface, naming both files',
        (platform) => {
            const entries = [
                makeSurfaceEntry('Sheet', { file: '/one.tsx' }),
                makeSurfaceEntry('Sheet', { file: '/two.tsx' }),
            ];
            const surface = { web: [], native: [], [platform]: entries };

            try {
                assertDistinctNames(surface);
                expect.unreachable();
            } catch (error) {
                expect(isDesignArtifactError(error) && error.code).toBe('duplicate-name');
                expect((error as Error).message).toContain(platform);
                expect((error as Error).message).toContain('/one.tsx');
                expect((error as Error).message).toContain('/two.tsx');
            }
        },
    );
});
