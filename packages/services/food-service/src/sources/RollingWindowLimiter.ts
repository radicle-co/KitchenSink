/**
 * `RollingWindowLimiter` — the admission Policy every source call passes (ADR-0053 §1, §2, §6). It reads each source's
 * declared limit from the register, applies a lowering override, and asks the call ledger to admit the call against
 * ⌊0.9 × requests⌋ over that source's own window. USDA therefore counts per hour and Matvaretabellen per day.
 *
 * The rate-limited transport calls {@link RollingWindowLimiter.admit} before every upstream request, so no caller
 * charges the window by hand. The ledger owns atomicity (one transaction under the per-source advisory lock) and the
 * shared block; this class owns only which limit applies.
 *
 * **Two lanes on one budget (F-W1).** Both lanes are admitted against the same 90% ceiling on one count (owner ruling
 * 2026-09-15, "Up to 900", now every source's rule). The lane is an attribution, recorded on every call, never a
 * second budget.
 *
 * @pattern Policy — which limit applies to a call, over the ledger that enforces it
 * @implements FR-019 FR-020 FR-021 FR-026
 */
import { settingFromEnv } from '../config/env.schema.js';
import type { SourceCallLogDao } from '../foods/dao/sourceCallLog.dao.js';
import { WIRED_SOURCE_IDS, type FoodSourceId } from './foodSourceAdapter.js';
import { apiAccessOf, CALLABLE_API_SOURCES, type CallableApiSourceId } from './sourceRegister.js';
import { judgeLimitOverride, type SourceLimitOverrides, type WindowLimit } from './transport/limitOverride.js';
import type { Admission, AdmissionPolicy, SourceCallChannel } from './transport/RateLimitedTransport.js';
import { sourceCeiling } from './transport/sourceCeiling.js';

/** What the limiter needs from the call ledger. `SourceCallLogDao` is the production one. */
export type WindowLedger = Pick<SourceCallLogDao, 'admit' | 'windowStatus' | 'pruneAged'>;

/**
 * How far back the call ledger must keep rows: the longest window any callable source declares. Overrides only
 * shorten a window, so they never lengthen this.
 */
export const PRUNE_HORIZON_SECONDS = Math.max(
    ...CALLABLE_API_SOURCES.map((source) => apiAccessOf(source).rateLimit.windowSeconds),
);

/** One source's window, as the admin metrics report it (FR-039). */
export interface SourceWindowStatus {
    /** Calls inside the source's trailing window, both lanes. */
    readonly windowCount: number;
    /** The source's limit in force: declared, or the override. */
    readonly hardCap: number;
    /** The admission ceiling, 90% of the limit. */
    readonly pauseThreshold: number;
    /** Whether admission refuses now: the count is at the ceiling, or a block is live. */
    readonly paused: boolean;
}

/**
 * Check every override against its declared limit. Pure.
 *
 * @param overrides - The overrides.
 * @returns The same overrides.
 * @throws {Error} naming the source when an override could admit more than its declared limit.
 */
function checkedOverrides(overrides: SourceLimitOverrides): SourceLimitOverrides {
    for (const source of CALLABLE_API_SOURCES) {
        const override = overrides[source];

        if (override === undefined) {
            continue;
        }

        const verdict = judgeLimitOverride(apiAccessOf(source).rateLimit, override);

        if (!verdict.admitted) {
            throw new Error(`The limit override for '${source}' is refused: ${verdict.reason}`);
        }
    }

    return overrides;
}

export class RollingWindowLimiter implements AdmissionPolicy {
    private readonly overrides: SourceLimitOverrides;

    /**
     * @param ledger - The call ledger backing every window.
     * @param overrides - Lowering overrides keyed by source. Defaults to `FOOD_SOURCE_LIMIT_OVERRIDES`, so every
     *   process that builds a limiter honours the stage's setting.
     * @throws {Error} when an override would raise a declared limit.
     * @sideEffect Reads `process.env` when no overrides are given.
     */
    public constructor(
        private readonly ledger: WindowLedger,
        overrides?: SourceLimitOverrides,
    ) {
        this.overrides = checkedOverrides(overrides ?? settingFromEnv('FOOD_SOURCE_LIMIT_OVERRIDES'));
    }

    /**
     * Admit one call to `source` on `lane`, recording it when admitted.
     *
     * @param source - The source to be called.
     * @param lane - Who is spending the call.
     * @returns Admitted, or refused with the reason and the earliest retry.
     * @sideEffect Charges the source's window when admitting.
     */
    public async admit(source: CallableApiSourceId, lane: SourceCallChannel): Promise<Admission> {
        const limit = this.limitFor(source);

        return this.ledger.admit({
            source,
            lane,
            ceiling: sourceCeiling(limit.requests),
            windowSeconds: limit.windowSeconds,
        });
    }

    /**
     * One source's window, for the admin metrics.
     *
     * @param source - The source.
     * @returns The count, the limit in force, its ceiling, and whether admission refuses now.
     * @sideEffect Reads `source_call_log` and `source_backoff`.
     */
    public async status(source: CallableApiSourceId): Promise<SourceWindowStatus> {
        const limit = this.limitFor(source);
        const ceiling = sourceCeiling(limit.requests);
        const { count, blockedUntil } = await this.ledger.windowStatus(source, limit.windowSeconds);

        return {
            windowCount: count,
            hardCap: limit.requests,
            pauseThreshold: ceiling,
            paused: count >= ceiling || blockedUntil !== null,
        };
    }

    /**
     * The sources the live path calls, which the admin metrics report.
     *
     * @returns The wired sources.
     */
    public knownSources(): readonly FoodSourceId[] {
        return WIRED_SOURCE_IDS;
    }

    /**
     * Delete calls older than the longest declared window, so the ledger stays bounded (FR-020). Change-refresh calls
     * it at the start of every run.
     *
     * @returns The number of pruned rows.
     * @sideEffect Deletes from `source_call_log`.
     */
    public async pruneAged(): Promise<number> {
        return this.ledger.pruneAged(PRUNE_HORIZON_SECONDS);
    }

    /**
     * The limit in force for a source. Pure.
     *
     * @param source - The source.
     * @returns The override when there is one, else the declared limit.
     */
    private limitFor(source: CallableApiSourceId): WindowLimit {
        return this.overrides[source] ?? apiAccessOf(source).rateLimit;
    }
}
