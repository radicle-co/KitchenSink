/**
 * The remote search of a stage with no search service: every source is `unavailable`, never a silent empty answer
 * (ADR-0055 point 9).
 */
import { describe, expect, it } from 'vitest';

import { UnconfiguredRemoteSearch } from '../UnconfiguredRemoteSearch.js';

describe('UnconfiguredRemoteSearch', () => {
    it('answers every source unavailable, never an empty answer the cook would read as "nothing found"', async () => {
        await expect(new UnconfiguredRemoteSearch().search()).resolves.toEqual({ kind: 'unavailable' });
    });
});
