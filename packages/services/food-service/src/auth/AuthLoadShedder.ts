/**
 * `AuthLoadShedder` (T-054, FR-052) — the auth-layer DoS defense fronting `FoodAuthGuard`.
 *
 * A flood of well-formed-but-invalid bearer tokens is the cheapest way to saturate a networkless
 * verifier: each token forces a CPU-bound RSA signature check before the fail-closed `401`. Left
 * unbounded that starves legitimate requests and breaches SC-011 (verify ≤10ms p95) and SC-009
 * availability. This shedder bounds the damage two ways, both cheap and in-process:
 *
 * 1. **Verification-concurrency bound** — at most `maxConcurrent` signature checks run at once. Beyond
 *    that, requests are shed (`503`) instead of queueing unboundedly behind the saturated CPU.
 * 2. **Per-source rolling `401`-rate cap** — failures are counted per source (client IP) in a sliding
 *    `shedWindowMs` window; once a source reaches `shedThreshold` failures it is shed (`503`) WITHOUT
 *    running the expensive verification, so a single flooding source cannot consume CPU. The window
 *    self-heals: as failures age out the source is admitted again — no cooldown bookkeeping.
 *
 * The source key is the leftmost `X-Forwarded-For` hop (the shared ALB sets it) falling back to the
 * socket address. It is used ONLY as a shedding bucket, never for identity/authz (identity still comes
 * exclusively from the verified token) — spoofing it only spreads an attacker's own flood across
 * buckets, against which the global concurrency bound still holds.
 *
 * @implements FR-052
 */

/** Default max concurrent in-flight token verifications. */
const DEFAULT_MAX_CONCURRENT = 24;

/** Default per-source failure threshold within the window before shedding. */
const DEFAULT_SHED_THRESHOLD = 100;

/** Default rolling failure-window in milliseconds. */
const DEFAULT_SHED_WINDOW_MS = 10_000;

/** The request fields the shedder reads to derive a stable source key. */
export interface SourceKeyInput {
    /** The `X-Forwarded-For` header value (comma-separated hops), when present. */
    readonly xForwardedFor: string | undefined;
    /** The connection's remote address (`req.ip` / socket), when known. */
    readonly ip: string | undefined;
}

/** Construction options (all optional; sensible production defaults, override per env/test). */
export interface AuthLoadShedderOptions {
    /** Max concurrent verifications (default {@link DEFAULT_MAX_CONCURRENT}). */
    readonly maxConcurrent?: number;
    /** Per-source failure threshold within the window (default {@link DEFAULT_SHED_THRESHOLD}). */
    readonly shedThreshold?: number;
    /** Rolling failure-window in ms (default {@link DEFAULT_SHED_WINDOW_MS}). */
    readonly shedWindowMs?: number;
    /** Injectable clock (default `Date.now`) — deterministic in tests. */
    readonly now?: () => number;
}

export class AuthLoadShedder {
    private readonly maxConcurrent: number;
    private readonly shedThreshold: number;
    private readonly shedWindowMs: number;
    private readonly now: () => number;

    /** Live count of in-flight verifications. */
    private inFlightCount = 0;
    /** Per-source ring of recent failure timestamps (ms). Pruned lazily on read/write. */
    private readonly failures = new Map<string, number[]>();

    /** @param options - Concurrency bound, per-source cap, window, and clock. */
    public constructor(options: AuthLoadShedderOptions = {}) {
        this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
        this.shedThreshold = options.shedThreshold ?? DEFAULT_SHED_THRESHOLD;
        this.shedWindowMs = options.shedWindowMs ?? DEFAULT_SHED_WINDOW_MS;
        this.now = options.now ?? Date.now;
    }

    /**
     * Derive a stable shedding bucket for a request: the leftmost `X-Forwarded-For` hop, else the
     * socket address, else `'unknown'`. Pure (no state).
     *
     * @param input - The forwarded-for header + socket address.
     * @returns The source key.
     */
    public sourceKey(input: SourceKeyInput): string {
        const forwarded = input.xForwardedFor?.split(',')[0]?.trim();

        if (forwarded && forwarded.length > 0) {
            return forwarded;
        }

        return input.ip && input.ip.length > 0 ? input.ip : 'unknown';
    }

    /**
     * Whether a source is currently shedding (its failures in the rolling window reached the threshold).
     * Cheap — runs before any verification so a flood is rejected without a signature check.
     *
     * @param sourceKey - The bucket from {@link sourceKey}.
     * @returns `true` when the source should be shed with `503`.
     * @sideEffect Prunes the source's aged-out failure timestamps.
     */
    public shouldShed(sourceKey: string): boolean {
        return this.recentFailures(sourceKey) >= this.shedThreshold;
    }

    /**
     * Try to take a verification slot.
     *
     * @returns `true` when a slot was acquired (caller MUST {@link release}); `false` when saturated.
     * @sideEffect Increments the in-flight count on success.
     */
    public tryAcquire(): boolean {
        if (this.inFlightCount >= this.maxConcurrent) {
            return false;
        }

        this.inFlightCount += 1;

        return true;
    }

    /**
     * Release a previously-acquired verification slot.
     *
     * @sideEffect Decrements the in-flight count (floored at zero).
     */
    public release(): void {
        if (this.inFlightCount > 0) {
            this.inFlightCount -= 1;
        }
    }

    /** The live in-flight verification count. */
    public inFlight(): number {
        return this.inFlightCount;
    }

    /**
     * Record a verification FAILURE (a fail-closed `401`) for a source, feeding the rolling cap.
     *
     * @param sourceKey - The bucket from {@link sourceKey}.
     * @sideEffect Appends a timestamp to the source's failure ring.
     */
    public recordFailure(sourceKey: string): void {
        const ring = this.failures.get(sourceKey) ?? [];
        ring.push(this.now());
        this.failures.set(sourceKey, ring);
    }

    /** Count a source's failures still inside the rolling window, pruning aged-out ones. */
    private recentFailures(sourceKey: string): number {
        const ring = this.failures.get(sourceKey);

        if (!ring) {
            return 0;
        }

        const cutoff = this.now() - this.shedWindowMs;
        const live = ring.filter((stamp) => stamp > cutoff);

        if (live.length === 0) {
            this.failures.delete(sourceKey);
        } else {
            this.failures.set(sourceKey, live);
        }

        return live.length;
    }
}
