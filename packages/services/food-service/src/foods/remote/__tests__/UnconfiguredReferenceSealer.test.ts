/**
 * The reference sealer of a stage with no remote search (ADR-0055 point 10): it issued nothing, so it opens nothing,
 * and a pick of any reference is answered as gone rather than as a server fault.
 */
import { describe, expect, it } from 'vitest';

import { isInvalidRemoteReferenceError } from '../remoteReference.errors.js';
import { UnconfiguredReferenceSealer } from '../UnconfiguredReferenceSealer.js';

describe('UnconfiguredReferenceSealer', () => {
    it('opens nothing, as unreadable', async () => {
        await expect(new UnconfiguredReferenceSealer().open('a.b.c.d.e')).rejects.toSatisfy(
            (error: unknown) => isInvalidRemoteReferenceError(error) && error.reason === 'unreadable',
        );
    });

    it('refuses to seal, because no remote hit exists to carry a reference', async () => {
        await expect(
            new UnconfiguredReferenceSealer().seal({
                source: 'usda',
                externalKey: '1',
                lineageKey: null,
                name: 'Kale',
            }),
        ).rejects.toThrow(/not configured/u);
    });
});
