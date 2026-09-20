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
 * The source key is the leftmost `X-Forwarded-For` hop (the shared ALB APPENDS to it) falling back to the
 * socket address. It is used ONLY as a shedding bucket, never for identity/authz — identity still comes
 * exclusively from the verified token.
 *
 * ⚠️ The key is therefore CALLER-CONTROLLED, and the original reasoning here ("spoofing it only spreads
 * an attacker's own flood across buckets, against which the global concurrency bound still holds") was
 * true about CPU and false about MEMORY: a fresh key per request minted a Map entry per request that
 * nothing ever removed, because pruning only touched the key it was asked about. The bucket count is now
 * bounded and evicted least-recently-failed-first — see `recordFailure` below (finding `02.F-F1`).
 *
 * ⛔ Do NOT "fix" the spoofing by keying on the RIGHTMOST hop instead. Once the CloudFront edge of
 * ADR-0020 is in front of the ALB, the appended hop is CloudFront's address and every request on earth
 * collapses into one bucket.
 *
 * @implements FR-052
 */

/** Default max concurrent in-flight token verifications. */
const DEFAULT_MAX_CONCURRENT = 24;

/** Default per-source failure threshold within the window before shedding. */
const DEFAULT_SHED_THRESHOLD = 100;

/** Default rolling failure-window in milliseconds. */
const DEFAULT_SHED_WINDOW_MS = 10_000;

/**
 * Default ceiling on how many source buckets are tracked at once.
 *
 * ⛔ THIS BOUND IS THE WHOLE DEFENCE OF THE DEFENCE. The bucket key is caller-controlled — the ALB
 * APPENDS to `X-Forwarded-For` rather than replacing it, so an unauthenticated client picks its own
 * leftmost hop and can pick a fresh one per request. Unbounded, the map grew one entry per request and
 * never shrank (pruning only ever touched the key being asked about), which turns the anti-DoS control
 * into a remote memory-exhaustion vector reachable with no credential at all — finding `02.F-F1`.
 *
 * 50,000 entries is ~ a few MB against a task sized in hundreds, and is far above any plausible count of
 * genuine client IPs in one 10-second window, so a real flood still trips the per-source cap.
 */
const DEFAULT_MAX_TRACKED_SOURCES = 50_000;

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
    /** Max distinct source buckets tracked (default {@link DEFAULT_MAX_TRACKED_SOURCES}). */
    readonly maxTrackedSources?: number;
    /** Injectable clock (default `Date.now`) — deterministic in tests. */
    readonly now?: () => number;
}

export class AuthLoadShedder {
    private readonly maxConcurrent: number;
    private readonly shedThreshold: number;
    private readonly shedWindowMs: number;
    private readonly maxTrackedSources: number;
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
        this.maxTrackedSources = options.maxTrackedSources ?? DEFAULT_MAX_TRACKED_SOURCES;
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
     * Bounded on BOTH axes, because the key is attacker-chosen: the source's own ring is pruned to the
     * rolling window (so one key cannot grow with the request count), and the map is evicted down to
     * {@link AuthLoadShedderOptions.maxTrackedSources} (so the number of keys cannot grow either).
     *
     * The delete-then-set is load-bearing: `Map#set` on an EXISTING key keeps its original insertion
     * position, so re-inserting is what makes iteration order least-recently-failed-first and therefore
     * makes the eviction below LRU rather than arbitrary. A genuinely flooding source keeps failing, so it
     * keeps returning to the tail and survives; a one-shot spoofed key ages out of the head first.
     *
     * Eviction is head-first and O(1) per entry rather than a periodic full sweep — an O(n) sweep on every
     * write would hand the same attacker a CPU amplifier in place of the memory one.
     *
     * @param sourceKey - The bucket from {@link sourceKey}.
     * @sideEffect Appends a timestamp to the source's failure ring, and may evict other sources.
     */
    public recordFailure(sourceKey: string): void {
        const cutoff = this.now() - this.shedWindowMs;
        const ring = (this.failures.get(sourceKey) ?? []).filter((stamp) => stamp > cutoff);
        ring.push(this.now());

        this.failures.delete(sourceKey);
        this.failures.set(sourceKey, ring);

        while (this.failures.size > this.maxTrackedSources) {
            const oldest = this.failures.keys().next();

            if (oldest.done === true) {
                break;
            }

            this.failures.delete(oldest.value);
        }
    }

    /** How many source buckets are currently held — the quantity {@link recordFailure} bounds. */
    public trackedSources(): number {
        return this.failures.size;
    }

    /**
     * How many of one source's failures are still inside the rolling window.
     *
     * @param sourceKey - The bucket from {@link sourceKey}.
     * @returns The live failure count.
     * @sideEffect Prunes that source's aged-out timestamps, as {@link shouldShed} does.
     */
    public trackedFailures(sourceKey: string): number {
        return this.recentFailures(sourceKey);
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
