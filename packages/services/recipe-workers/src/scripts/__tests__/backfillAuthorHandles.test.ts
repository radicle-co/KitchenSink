/**
 * W8-a.2 — unit tests for the author-handle backfill core. Pins the iteration contract: every profile is
 * applied through the (monotonic) applier, a blank display name is skipped, and the seen/applied/skipped
 * counts are accurate — including when the monotonic guard rejects an already-fresher row (idempotent re-run).
 */
import { describe, it, expect, vi } from 'vitest';

import { backfillAuthorHandles, type IdentityProfile } from '../backfillAuthorHandles.js';

async function* profiles(rows: IdentityProfile[]): AsyncIterable<IdentityProfile> {
    for (const row of rows) {
        yield row;
    }
}

const at = (iso: string): Date => new Date(iso);

describe('backfillAuthorHandles', () => {
    it('applies each profile as a synthetic rename carrying updatedAt as the source timestamp', async () => {
        const apply = vi.fn().mockResolvedValue(true);

        const result = await backfillAuthorHandles(
            profiles([
                { userId: 'u1', displayName: 'Ada Lovelace', updatedAt: at('2026-07-20T00:00:00.000Z') },
                { userId: 'u2', displayName: 'Alan Turing', updatedAt: at('2026-07-19T00:00:00.000Z') },
            ]),
            apply,
        );

        expect(result).toEqual({ seen: 2, applied: 2, skipped: 0 });
        expect(apply).toHaveBeenNthCalledWith(1, {
            userId: 'u1',
            displayName: 'Ada Lovelace',
            sourceTimestamp: '2026-07-20T00:00:00.000Z',
        });
    });

    it('skips a blank display name (nothing to attribute) without calling the applier', async () => {
        const apply = vi.fn().mockResolvedValue(true);

        const result = await backfillAuthorHandles(
            profiles([{ userId: 'u1', displayName: '   ', updatedAt: at('2026-07-20T00:00:00.000Z') }]),
            apply,
        );

        expect(result).toEqual({ seen: 1, applied: 0, skipped: 1 });
        expect(apply).not.toHaveBeenCalled();
    });

    it('counts a monotonic-guard rejection as skipped (idempotent re-run over already-synced rows)', async () => {
        // apply returns false → the read model already had a newer-or-equal timestamp; nothing changed.
        const apply = vi.fn().mockResolvedValue(false);

        const result = await backfillAuthorHandles(
            profiles([{ userId: 'u1', displayName: 'Ada', updatedAt: at('2026-07-01T00:00:00.000Z') }]),
            apply,
        );

        expect(result).toEqual({ seen: 1, applied: 0, skipped: 1 });
    });
});
