/**
 * Earned autonomy's storage verbs (plan U3, migration 0036) — the ONE implementation of the band state
 * machine's SQL, shared by both of its writers.
 *
 * ⛔ WHY THIS LIVES IN recipe-core AND NOT IN A DAL: the state machine has TWO writers on opposite sides
 * of the worker seam — recipe-service records R16 correction disagreements (and consults authority in the
 * producer), recipe-workers records gate/shadow verdicts — and `recipe-workers/src/common/db.ts` refuses
 * to import recipe-service internals. Two hand-copied implementations of "authorize = upsert with
 * `epoch + 1`" is exactly the knowledge-drift DRY governs: an epoch that increments differently on one
 * side silently breaks R14's revocation enumeration. So the SQL is authored once, over the narrowest
 * possible port ({@link BandSqlRunner}) so this package stays dependency-free: recipe-service adapts its
 * `pg.Pool`, the workers adapt `db.$client`.
 *
 * The DECISIONS live in `bandPolicy.ts` (pure, truth-table tested); this class owns only how they are
 * remembered:
 *
 *  - `authorityFor` / `applyTransition` — the per-band state machine. Authorize is an UPSERT that
 *    increments the epoch (each grant is a new epoch — what makes revocation's re-verification
 *    enumerable, R14); revoke flips state without touching the epoch; hold writes NOTHING — a band that
 *    has never crossed a threshold has no row, and an absent row reads as "verify".
 *  - `recordObservation` / `statsFor` / `recordObservationAndEvaluate` — the measured record and its
 *    evaluation. Verdicts are agree/disagree ONLY (a could-not-judge is absence); R16's corrections land
 *    as `('disagree', 'correction')`.
 *  - `recordSkip` / `undrainedRevokedSkips` / `markDrained` — the skip audit. A skip stores the READY
 *    verification message the producer built at skip time; the drain reads only skips whose band is now
 *    `revoked`, oldest first, and marks rather than deletes (the row is the audit of what skipped).
 *
 * ⚠️ `recordObservationAndEvaluate` is multiple statements, not a transaction, and that is TOLERATED
 * rather than overlooked: two concurrent evaluations can double-increment an epoch (harmless — skips
 * record whichever epoch they saw) or briefly write stale state (self-correcting — the next observation
 * re-evaluates from full stats, and every race's losing side degrades toward "verify", the safe
 * direction).
 */
import {
    decideBandAuthority,
    type BandObservationSourceId,
    type BandAuthority,
    type BandTransition,
} from './bandPolicy.js';

/**
 * The narrowest SQL port: parameterized text in, rows out. Both writers adapt their own handle to it;
 * nothing here may learn which one is calling.
 */
export type BandSqlRunner = (text: string, params: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;

/** One band's full identity — every read and write is scoped by all four axes (R15). */
export interface BandKey {
    readonly rung: string;
    readonly marginBand: string;
    readonly queryShape: string;
    readonly rankerVersion: string;
}

/** One stored skip, as the revocation drain reads it. */
export interface BandSkip {
    readonly id: string;
    readonly band: BandKey;
    readonly epoch: number;
    /** The producer-built `VerifyIngredientLineMessage`, verbatim. */
    readonly message: unknown;
}

/**
 * A band key's canonical text form — the Map key both halves of the producer agree on (the impure half
 * loads authorities under it, the pure builder looks consultations up by it).
 *
 * @param band - The full band key.
 * @returns The joined text. Pure.
 */
export function bandKeyText(band: BandKey): string {
    return [band.rung, band.marginBand, band.queryShape, band.rankerVersion].join('|');
}

/** The four key params in the column order every statement uses. */
function keyParams(band: BandKey): readonly unknown[] {
    return [band.rung, band.marginBand, band.queryShape, band.rankerVersion];
}

export class BandAuthorityStore {
    public constructor(private readonly run: BandSqlRunner) {}

    /**
     * The band's stored authority, or `undefined` when it has never crossed a threshold.
     *
     * @param band - The full band key.
     * @returns State + epoch, or `undefined`. @sideEffect One SELECT.
     */
    public async authorityFor(band: BandKey): Promise<BandAuthority | undefined> {
        const rows = await this.run(
            `SELECT state, epoch FROM resolution_band_authority
              WHERE rung = $1 AND margin_band = $2 AND query_shape = $3 AND ranker_version = $4`,
            keyParams(band),
        );
        const row = rows[0];

        if (row === undefined) {
            return undefined;
        }

        return { state: row['state'] as BandAuthority['state'], epoch: Number(row['epoch']) };
    }

    /**
     * Record one measured verdict for a band.
     *
     * @param band - The full band key.
     * @param verdict - `agree` or `disagree` — never a could-not-judge, which is absence.
     * @param source - Where the verdict came from (`gate`, `shadow`, or R16's `correction`).
     * @sideEffect One INSERT.
     */
    public async recordObservation(
        band: BandKey,
        verdict: 'agree' | 'disagree',
        source: BandObservationSourceId,
    ): Promise<void> {
        await this.run(
            `INSERT INTO resolution_band_observations (rung, margin_band, query_shape, ranker_version, verdict, source)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [...keyParams(band), verdict, source],
        );
    }

    /**
     * The band's all-time measured record within its ranker version.
     *
     * @param band - The full band key.
     * @returns Agreement/disagreement counts, aggregated in SQL. @sideEffect One SELECT.
     */
    public async statsFor(band: BandKey): Promise<{ agreements: number; disagreements: number }> {
        const rows = await this.run(
            `SELECT count(*) FILTER (WHERE verdict = 'agree')    AS agreements,
                    count(*) FILTER (WHERE verdict = 'disagree') AS disagreements
               FROM resolution_band_observations
              WHERE rung = $1 AND margin_band = $2 AND query_shape = $3 AND ranker_version = $4`,
            keyParams(band),
        );
        const row = rows[0];

        return {
            agreements: Number(row?.['agreements'] ?? 0),
            disagreements: Number(row?.['disagreements'] ?? 0),
        };
    }

    /**
     * Apply a policy transition to the stored state.
     *
     * `hold` deliberately writes NOTHING — most bands never cross a threshold, and an absent row already
     * means "verify", so materializing every observed band would be rows without information.
     *
     * @param band - The full band key.
     * @param transition - What `decideBandAuthority` decided.
     * @sideEffect At most one UPSERT/UPDATE.
     */
    public async applyTransition(band: BandKey, transition: BandTransition): Promise<void> {
        if (transition === 'hold') {
            return;
        }

        if (transition === 'authorize') {
            await this.run(
                `INSERT INTO resolution_band_authority
                     (rung, margin_band, query_shape, ranker_version, state, epoch, granted_at, updated_at)
                 VALUES ($1, $2, $3, $4, 'authorized', 1, now(), now())
                 ON CONFLICT (rung, margin_band, query_shape, ranker_version) DO UPDATE
                    SET state = 'authorized',
                        epoch = resolution_band_authority.epoch + 1,
                        granted_at = now(),
                        updated_at = now()`,
                keyParams(band),
            );

            return;
        }

        await this.run(
            `UPDATE resolution_band_authority
                SET state = 'revoked', revoked_at = now(), updated_at = now()
              WHERE rung = $1 AND margin_band = $2 AND query_shape = $3 AND ranker_version = $4`,
            keyParams(band),
        );
    }

    /**
     * The composite both writers actually call: record the verdict, then re-evaluate the band from its
     * full measured record and apply whatever the policy decides.
     *
     * @param band - The full band key.
     * @param verdict - `agree` or `disagree`.
     * @param source - Where the verdict came from.
     * @returns The transition that was applied. @sideEffect One INSERT, two SELECTs, at most one write.
     */
    public async recordObservationAndEvaluate(
        band: BandKey,
        verdict: 'agree' | 'disagree',
        source: BandObservationSourceId,
    ): Promise<BandTransition> {
        await this.recordObservation(band, verdict, source);

        const authority = await this.authorityFor(band);
        const stats = await this.statsFor(band);
        const transition = decideBandAuthority(authority?.state ?? 'observing', stats);
        await this.applyTransition(band, transition);

        return transition;
    }

    /**
     * How many observations have landed since the band's CURRENT grant — the shadow ramp's input
     * (`shadowRateFor`): 50% during the burn-in, 5% steady after.
     *
     * @param band - The full band key.
     * @returns The post-grant observation count (0 when the band has no grant). @sideEffect One SELECT.
     */
    public async observationsSinceGrant(band: BandKey): Promise<number> {
        const rows = await this.run(
            `SELECT count(*) AS observed
               FROM resolution_band_observations o
               JOIN resolution_band_authority a
                 ON a.rung = o.rung
                AND a.margin_band = o.margin_band
                AND a.query_shape = o.query_shape
                AND a.ranker_version = o.ranker_version
              WHERE o.rung = $1 AND o.margin_band = $2 AND o.query_shape = $3 AND o.ranker_version = $4
                AND a.granted_at IS NOT NULL
                AND o.created_at >= a.granted_at`,
            keyParams(band),
        );

        return Number(rows[0]?.['observed'] ?? 0);
    }

    /**
     * Record one authorized skip with its ready verification message.
     *
     * @param band - The full band key.
     * @param epoch - The authority epoch the skip happened under (R14).
     * @param message - The producer-built `VerifyIngredientLineMessage`, verbatim.
     * @sideEffect One INSERT.
     */
    public async recordSkip(band: BandKey, epoch: number, message: unknown): Promise<void> {
        await this.run(
            `INSERT INTO resolution_band_skips (rung, margin_band, query_shape, ranker_version, epoch, message)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
            [...keyParams(band), epoch, JSON.stringify(message)],
        );
    }

    /**
     * The revocation drain's read: undrained skips whose band is now `revoked`, oldest first.
     *
     * ⚠️ Epoch is deliberately NOT filtered: any undrained skip of a revoked band re-verifies, whichever
     * grant it happened under — a skip from an earlier epoch that somehow never drained is exactly the
     * row this sweep exists to catch.
     *
     * @param limit - Batch size, chosen by the caller against spend headroom.
     * @returns The claimed rows. @sideEffect One SELECT.
     */
    public async undrainedRevokedSkips(limit: number): Promise<readonly BandSkip[]> {
        const rows = await this.run(
            `SELECT s.id, s.rung, s.margin_band, s.query_shape, s.ranker_version, s.epoch, s.message
               FROM resolution_band_skips s
               JOIN resolution_band_authority a
                 ON a.rung = s.rung
                AND a.margin_band = s.margin_band
                AND a.query_shape = s.query_shape
                AND a.ranker_version = s.ranker_version
              WHERE s.drained_at IS NULL AND a.state = 'revoked'
              ORDER BY s.created_at ASC
              LIMIT $1`,
            [limit],
        );

        return rows.map((row) => ({
            id: String(row['id']),
            band: {
                rung: String(row['rung']),
                marginBand: String(row['margin_band']),
                queryShape: String(row['query_shape']),
                rankerVersion: String(row['ranker_version']),
            },
            epoch: Number(row['epoch']),
            message: row['message'],
        }));
    }

    /**
     * Mark drained skips — never delete them; the rows are the audit of what skipped.
     *
     * @param ids - The skips whose messages were sent.
     * @sideEffect One UPDATE.
     */
    public async markDrained(ids: readonly string[]): Promise<void> {
        if (ids.length === 0) {
            return;
        }

        await this.run(`UPDATE resolution_band_skips SET drained_at = now() WHERE id = ANY($1::uuid[])`, [[...ids]]);
    }
}
