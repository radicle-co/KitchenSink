/**
 * U3 — `ResolutionBandsDal` against a real Docker PostgreSQL (migration 0036).
 *
 * ⛔ WHY THIS TIER IS MANDATORY: the DAL's claims are all claims about the DATABASE — that the transition
 * upsert increments the epoch atomically, that `statsFor` aggregates in SQL, and that the drain reads
 * ONLY the skips of revoked bands, oldest first. A unit test mocks all of that into tautology.
 *
 * Rows are namespaced under `ranker_version` prefixed `dal-test` and swept in afterEach.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { ResolutionBandsDal, type BandKey } from '../../../src/ingredients/resolution/resolutionBands.dal.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
const hasDatabaseUrl = Boolean(DATABASE_URL);

const BAND: BandKey = { rung: 'head', marginBand: '0.15+', queryShape: 'single-token', rankerVersion: 'dal-test-v1' };
const OTHER_BAND: BandKey = { ...BAND, queryShape: 'multi-word' };

describe.skipIf(!hasDatabaseUrl)('ResolutionBandsDal (migration 0036)', () => {
    let pool: pg.Pool;
    let dal: ResolutionBandsDal;

    beforeAll(() => {
        pool = new pg.Pool({ connectionString: DATABASE_URL });
        dal = new ResolutionBandsDal(pool);
    });

    afterEach(async () => {
        await pool.query(`DELETE FROM resolution_band_skips WHERE ranker_version LIKE 'dal-test%'`);
        await pool.query(`DELETE FROM resolution_band_observations WHERE ranker_version LIKE 'dal-test%'`);
        await pool.query(`DELETE FROM resolution_band_authority WHERE ranker_version LIKE 'dal-test%'`);
    });

    afterAll(async () => {
        await pool.end();
    });

    it('answers undefined for a band never observed — the caller reads that as verify', async () => {
        expect(await dal.authorityFor(BAND)).toBeUndefined();
    });

    it('aggregates observations into stats regardless of source, in the database', async () => {
        await dal.recordObservation(BAND, 'agree', 'gate');
        await dal.recordObservation(BAND, 'agree', 'shadow');
        await dal.recordObservation(BAND, 'disagree', 'correction');
        await dal.recordObservation(OTHER_BAND, 'agree', 'gate');

        expect(await dal.statsFor(BAND)).toStrictEqual({ agreements: 2, disagreements: 1 });
        expect(await dal.statsFor(OTHER_BAND)).toStrictEqual({ agreements: 1, disagreements: 0 });
    });

    it('authorize is an UPSERT that increments the epoch and stamps granted_at', async () => {
        await dal.applyTransition(BAND, 'authorize');

        const first = await dal.authorityFor(BAND);
        expect(first).toStrictEqual({ state: 'authorized', epoch: 1 });

        await dal.applyTransition(BAND, 'revoke');
        expect(await dal.authorityFor(BAND)).toStrictEqual({ state: 'revoked', epoch: 1 });

        // Re-earning grants a NEW epoch — which is what makes each grant's skips enumerable (R14).
        await dal.applyTransition(BAND, 'authorize');
        expect(await dal.authorityFor(BAND)).toStrictEqual({ state: 'authorized', epoch: 2 });
    });

    it('hold writes nothing — not even a row for a fresh band', async () => {
        await dal.applyTransition(BAND, 'hold');

        expect(await dal.authorityFor(BAND)).toBeUndefined();
    });

    it("the drain claims only REVOKED bands' undrained skips, oldest first, and marking sticks", async () => {
        await dal.applyTransition(BAND, 'authorize');
        await dal.applyTransition(OTHER_BAND, 'authorize');
        await dal.recordSkip(BAND, 1, { verificationKey: 'k-oldest' });
        await dal.recordSkip(BAND, 1, { verificationKey: 'k-newer' });
        await dal.recordSkip(OTHER_BAND, 1, { verificationKey: 'k-still-authorized' });

        // Nothing is revoked yet: nothing to drain.
        expect(await dal.undrainedRevokedSkips(10)).toStrictEqual([]);

        await dal.applyTransition(BAND, 'revoke');

        const claimed = await dal.undrainedRevokedSkips(10);
        expect(claimed.map((skip) => (skip.message as { verificationKey: string }).verificationKey)).toStrictEqual([
            'k-oldest',
            'k-newer',
        ]);

        await dal.markDrained([claimed[0]!.id]);
        const remaining = await dal.undrainedRevokedSkips(10);
        expect(remaining.map((skip) => (skip.message as { verificationKey: string }).verificationKey)).toStrictEqual([
            'k-newer',
        ]);
    });

    it('the composite evaluate GRANTS at the bar and REVOKES on a disagreement burst, end to end', async () => {
        // Seed 199 agreements in one statement — the 200th observation goes through the real composite.
        await pool.query(
            `INSERT INTO resolution_band_observations (rung, margin_band, query_shape, ranker_version, verdict, source)
             SELECT $1, $2, $3, $4, 'agree', 'gate' FROM generate_series(1, 199)`,
            [BAND.rung, BAND.marginBand, BAND.queryShape, BAND.rankerVersion],
        );

        expect(await dal.recordObservationAndEvaluate(BAND, 'agree', 'gate')).toBe('authorize');
        expect(await dal.authorityFor(BAND)).toStrictEqual({ state: 'authorized', epoch: 1 });

        // 200 agree + 2 disagree = 0.9901 < 0.995 — the SECOND disagreement crosses the bar downward.
        expect(await dal.recordObservationAndEvaluate(BAND, 'disagree', 'correction')).toBe('hold');
        expect(await dal.recordObservationAndEvaluate(BAND, 'disagree', 'correction')).toBe('revoke');
        expect(await dal.authorityFor(BAND)).toStrictEqual({ state: 'revoked', epoch: 1 });
    });

    it('counts observations SINCE the current grant only — the shadow ramp input', async () => {
        // Two observations before any grant: they must not count toward the burn-in.
        await dal.recordObservation(BAND, 'agree', 'gate');
        await dal.recordObservation(BAND, 'agree', 'gate');
        await dal.applyTransition(BAND, 'authorize');
        await dal.recordObservation(BAND, 'agree', 'shadow');

        expect(await dal.observationsSinceGrant(BAND)).toBe(1);
        // A band with no grant at all counts zero, whatever it has observed.
        await dal.recordObservation(OTHER_BAND, 'agree', 'gate');
        expect(await dal.observationsSinceGrant(OTHER_BAND)).toBe(0);
    });

    it('the drain respects its batch limit', async () => {
        await dal.applyTransition(BAND, 'authorize');
        await dal.recordSkip(BAND, 1, { verificationKey: 'a' });
        await dal.recordSkip(BAND, 1, { verificationKey: 'b' });
        await dal.applyTransition(BAND, 'revoke');

        expect(await dal.undrainedRevokedSkips(1)).toHaveLength(1);
    });
});
