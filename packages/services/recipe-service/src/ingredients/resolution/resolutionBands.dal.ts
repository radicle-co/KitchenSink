/**
 * The recipe service's adapter over the SHARED band-authority store (plan U3, migration 0036).
 *
 * ⛔ The SQL and the state machine live ONCE, in
 * `@kitchensink/recipe-core/resolution/band-authority-store` — because the state machine has a second
 * writer on the far side of the worker seam (the verification gate's feedback), and two hand-copied
 * "authorize = `epoch + 1`" implementations is knowledge drift that breaks R14's revocation enumeration.
 * This class only binds the store to this service's `pg.Pool`.
 *
 * This service's writers: the producer's authority consultation + skip recording (U4), and R16's
 * correction-as-disagreement (`recordObservationAndEvaluate(band, 'disagree', 'correction')`).
 */
import { BandAuthorityStore } from '@kitchensink/recipe-core/resolution/band-authority-store';
import type pg from 'pg';

export type { BandKey, BandSkip } from '@kitchensink/recipe-core/resolution/band-authority-store';

export class ResolutionBandsDal extends BandAuthorityStore {
    public constructor(pool: pg.Pool) {
        super(async (text, params) => {
            const result = await pool.query(text, [...params]);

            return result.rows as readonly Record<string, unknown>[];
        });
    }
}
