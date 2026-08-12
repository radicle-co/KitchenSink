/**
 * `RollingWindowLimiter` (T-122 / MOD-005, ARCH-005) — the per-source rolling-60-minute window over
 * {@link SourceCallLogDao}. It enforces each source's hard cap strictly (never a token bucket that
 * could emit ~2× cap across a rolling hour): admission is an atomic windowed count + conditional
 * insert. The worker (Phase 3) consults {@link RollingWindowLimiter.isPaused} BEFORE a fetch (soft 90%
 * pause = headroom for reads/resolves), {@link RollingWindowLimiter.tryRecord} to atomically charge the
 * window at fetch time (hard cap), and {@link RollingWindowLimiter.markWindowFull} on a source `429`
 * (failsafe back-off).
 *
 * @implements FR-019 FR-020 FR-021 FR-026
 */
import { settingFromEnv } from '../config/env.schema.js';
import type { SourceCallLogDao, WindowCheckResult } from '../foods/dao/index.js';
import type { FoodSourceId } from './food-source-adapter.js';

/** Fraction of a source's hard cap at which the worker pauses draining, leaving read/resolve headroom. */
const PAUSE_FRACTION = 0.9;

/** A source's rolling-window caps: the hard ceiling and the soft (90%) pause threshold. */
export interface SourceCap {
    /** The absolute ceiling — the window NEVER records past this in any trailing 60 minutes. */
    readonly hardCap: number;
    /** The soft pause threshold (90% of the cap) — the worker pauses draining at/above this. */
    readonly pauseThreshold: number;
}

/**
 * Build per-source caps from the source-agnostic env (`FOOD_SOURCE_RATE_LIMIT_PER_HOUR`, default 1,000 — defined
 * once in `config/env.schema.ts`); the pause threshold is 90% of the hard cap (FR-019).
 *
 * ⚠️ This is the LIMITER'S OWN default, resolved here rather than at each composition root, so every process
 * that constructs one honors the configured cap — the API, the fan-out worker (which is what consults
 * `isPaused`) and the change-refresh task all charge the SAME external quota. A caller who forgot to pass it
 * would silently fall back to a built-in cap, which is how the change-refresh task spent its life charging
 * USDA's shared quota at 1,000/hr while the operator had lowered the setting for the whole stage. It also lets a
 * preview lower the cap to exercise the pause without 900+ real USDA calls.
 *
 * @returns The per-source hard cap + 90% pause threshold.
 * @throws {Error} when `FOOD_SOURCE_RATE_LIMIT_PER_HOUR` is not a positive integer.
 * @sideEffect Reads `process.env`.
 */
export function sourceCapsFromEnv(): Record<FoodSourceId, SourceCap> {
    // A malformed value throws (naming the variable) instead of coercing to `NaN`, which would silently break
    // pause AND admission: every comparison against `NaN` is `false`, so the limiter would never pause and never
    // consider the window full.
    const hardCap = settingFromEnv('FOOD_SOURCE_RATE_LIMIT_PER_HOUR');

    return { usda: { hardCap, pauseThreshold: Math.floor(hardCap * PAUSE_FRACTION) } };
}

/** Default 429-failsafe back-off (ms) the window is treated as full for after a source `429`. */
const DEFAULT_BACKOFF_MS = 60_000;

export interface RollingWindowLimiterOptions {
    /**
     * Override per-source caps (e.g. small caps for tests); merged over the CONFIGURED caps — see
     * {@link sourceCapsFromEnv} for why those are the default.
     */
    readonly caps?: Partial<Record<FoodSourceId, SourceCap>>;
    /** 429-failsafe back-off in ms; defaults to {@link DEFAULT_BACKOFF_MS}. */
    readonly backoffMs?: number;
    /** Injectable clock (ms epoch) for deterministic tests; defaults to `Date.now`. */
    readonly now?: () => number;
}

export class RollingWindowLimiter {
    private readonly caps: Record<FoodSourceId, SourceCap>;
    private readonly backoffMs: number;
    private readonly now: () => number;
    /** Per-source `windowFullUntil` epoch-ms set by {@link markWindowFull} (the 429 failsafe). */
    private readonly windowFullUntil = new Map<FoodSourceId, number>();

    /**
     * @param dao - The per-source call-log DAO backing the window.
     * @param options - Optional caps / back-off / clock overrides.
     */
    public constructor(
        private readonly dao: SourceCallLogDao,
        options?: RollingWindowLimiterOptions,
    ) {
        this.caps = { ...sourceCapsFromEnv(), ...options?.caps };
        this.backoffMs = options?.backoffMs ?? DEFAULT_BACKOFF_MS;
        this.now = options?.now ?? Date.now;
    }

    /**
     * Atomically charge the window for `source` iff its trailing count is strictly under the hard cap (and the
     * 429 failsafe is not active). Records nothing when the window is full.
     *
     * @returns Whether the call was recorded, plus the post-attempt trailing count.
     * @sideEffect Inserts into `source_call_log` via the DAO when allowed.
     */
    public async tryRecord(source: FoodSourceId): Promise<WindowCheckResult> {
        if (this.isWindowFull(source)) {
            // 429 failsafe active: deny WITHOUT recording, reporting the unchanged trailing count.
            return { allowed: false, windowCount: await this.count(source) };
        }

        return this.dao.checkAndRecord({ source, cap: this.capFor(source).hardCap });
    }

    /** The trailing-60-minute call count for a source. @sideEffect Reads `source_call_log` via the DAO. */
    public async count(source: FoodSourceId): Promise<number> {
        return this.dao.countInWindow(source);
    }

    /**
     * The sources this limiter has caps configured for (the wired sources) — read by the admin
     * operational-metrics endpoint to report per-source window utilization (FR-039/US-10).
     */
    public knownSources(): FoodSourceId[] {
        return Object.keys(this.caps) as FoodSourceId[];
    }

    /**
     * A source's configured caps (hard ceiling + 90% pause threshold).
     *
     * @throws {Error} when no caps are configured for the source.
     */
    public capsFor(source: FoodSourceId): SourceCap {
        return this.capFor(source);
    }

    /**
     * Whether draining `source` should pause — true once the trailing count reaches the 90% pause threshold, OR
     * while the 429 failsafe back-off is active.
     *
     * @sideEffect Reads `source_call_log` via the DAO (unless short-circuited by the active failsafe).
     */
    public async isPaused(source: FoodSourceId): Promise<boolean> {
        if (this.isWindowFull(source)) {
            return true;
        }

        return (await this.count(source)) >= this.capFor(source).pauseThreshold;
    }

    /**
     * 429 failsafe: treat the window of a source that returned `429` as full for the back-off interval, so the
     * worker backs off draining it regardless of the recorded count (FR-026).
     *
     * @sideEffect Mutates the in-process `windowFullUntil` map.
     */
    public markWindowFull(source: FoodSourceId): void {
        this.windowFullUntil.set(source, this.now() + this.backoffMs);
    }

    /**
     * Prune call rows older than the trailing window so the ledger stays bounded (FR-020).
     *
     * @returns The number of pruned rows.
     * @sideEffect Deletes from `source_call_log` via the DAO.
     */
    public async pruneAged(source: FoodSourceId): Promise<number> {
        return this.dao.pruneAged(source);
    }

    /** Whether the 429 failsafe back-off is currently active for a source (i.e. has not elapsed). */
    private isWindowFull(source: FoodSourceId): boolean {
        const until = this.windowFullUntil.get(source);

        return until !== undefined && this.now() < until;
    }

    /**
     * Resolve a source's caps.
     *
     * @throws {Error} when no caps are configured for the source.
     */
    private capFor(source: FoodSourceId): SourceCap {
        const cap = this.caps[source];

        if (cap === undefined) {
            throw new Error(`No rate-limit caps configured for source '${source}'`);
        }

        return cap;
    }
}
