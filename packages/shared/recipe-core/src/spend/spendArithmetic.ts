/**
 * THE SPEND ARITHMETIC of the LLM verification gate's ceiling (plan U11 / R23, ADR-0024 §2 and §5).
 *
 * DESIGN PATTERN: **pure Policy module**, the `spend` sibling of `resolution/verificationGatePolicy.ts` and
 * the same split `deploy-gate.sh` uses — a pure `decide` (here: the whole rate table, the worst case, the
 * headroom, the period key and the settle delta) against an impure `evaluate` (`recipe-workers`'
 * `common/verificationSpend.ts`, which issues the two SQL statements and nothing else). ⛔ ADR-0024's ceiling
 * is not a thing you can test by deploying it: a $100 monthly cap fires roughly never, and the ONE event it
 * exists for — 8,000 calls a month becoming 800,000 — cannot be staged. So every judgement it makes lives
 * here, where it is a truth table, and the adapter is left with nothing to get wrong but the query.
 *
 * ## ⛔ WHY IT LIVES IN `recipe-core` AND NOT IN THE WORKER
 *
 * The same reason `resolution/normalizedKey.ts` does. `recipe-workers` runs the gate, but the ceiling and the
 * model id are configuration a second package will read (a runbook, a future admin surface), and the counter's
 * row is written by one process and audited by another. More immediately: this is arithmetic over MONEY with
 * no I/O in it, and it is exactly the kind of thing that gets quietly re-derived at a second call site. One
 * authoritative representation, imported.
 *
 * ⛔ **Reachable ONLY as `@kitchensink/recipe-core/spend/spend-arithmetic`, never from the barrel.**
 * `contract-gen`'s composed-sources fingerprint hashes `src/index.ts`, so one added line there moves the
 * recipe service's `CONTRACT_HASH` and lights up skew warnings on every pinned client — for a module with no
 * wire projection at all.
 *
 * ## The unit is MICRO-DOLLARS, and the arithmetic is integer
 *
 * A counter denominated in floats accumulates representation error over ~8,000 additions and subtractions a
 * month, in a value whose whole job is to be compared against a threshold. So costs are integer micro-dollars
 * (1,000,000 = $1) and every conversion rounds **UP** ({@link Math.ceil}) — the bias is deliberate and it is
 * always the same direction as ADR-0024's other biases: the counter may over-report, never under-report. At
 * the $100 ceiling the counter holds 100,000,000, six orders of magnitude below `Number.MAX_SAFE_INTEGER`, so
 * the `bigint` column it lives in never needs `BigInt` arithmetic here.
 *
 * ## ⚠️ The rate table is a HAND-MAINTAINED COPY of Bedrock's price list
 *
 * ADR-0024 records this as residual risk: a stale entry silently under-counts, layer 5's $20 Bedrock-filtered
 * budget is the detector, and every entry therefore carries the date its price was read AND whether it was
 * READ or assumed. It is also, deliberately, the **authority for what may be called at all** — {@link rateFor}
 * returning `undefined` makes {@link planReservation} return `unpriced`, the caller fails closed, and the call
 * is never made. That is why an unverified price is safe to carry and a missing one is safe to omit: an
 * unknown model id can only ever cost a denial, never uncounted spend.
 */

/** Micro-dollars per dollar. The counter's unit throughout: 1,000,000 micros = $1.00. */
export const MICROS_PER_DOLLAR = 1_000_000;

/** Tokens per "per-million-tokens" price quote — the denominator every published Bedrock rate uses. */
const TOKENS_PER_RATE_UNIT = 1_000_000;

/**
 * Amazon Nova Micro on `bedrock-runtime` — `KTD-4`'s pick and the model the gate ships with.
 *
 * Exported because it is the value the CDK seeds the model SSM parameter with. ⛔ It is NOT read at runtime:
 * ADR-0024 §3 requires the live model id to come from SSM so a change does not need a worker redeploy.
 */
export const NOVA_MICRO_MODEL_ID = 'amazon.nova-micro-v1:0';

/**
 * Anthropic Claude Haiku 4.5 on `bedrock-runtime` — the bake-off's only other candidate (ADR-0024 §4).
 *
 * ⛔ Gemini Flash-Lite is deliberately absent: it is not available on Bedrock at all, only Google's Gemma
 * models are, and naming it would break every premise that chose Bedrock (no vendor relationship, no secret,
 * no new egress path). Adding it is its own ADR, not a bake-off line item.
 */
export const CLAUDE_HAIKU_4_5_MODEL_ID = 'anthropic.claude-haiku-4-5-20251001-v1:0';

/**
 * The ceiling the CDK seeds the SSM parameter with — R23's owner-set $100 per calendar month.
 *
 * ⛔ Like {@link NOVA_MICRO_MODEL_ID}, this is a SEED and not the live value. R23 requires the ceiling be
 * configurable, and baking it into the function's environment would mean redeploying the worker stack to
 * lower it mid-incident. A lowered ceiling applies to subsequent reserves only; it never rewrites
 * reservations already taken, and it may deny immediately if the period's accumulated reservations already
 * exceed the new headroom.
 *
 * ⛔ There is exactly ONE ceiling and it is MONTHLY. ADR-0024 §3 removed the daily sub-ceiling an earlier
 * draft carried: a monthly ceiling is a hard cap rather than a slow detector, a second ceiling denies
 * legitimate bulk work, 31 × $5 never enforced $100 anyway, and it would turn the single-row invariant below
 * into two. Do not reintroduce one without re-deriving that invariant.
 */
export const DEFAULT_MONTHLY_CEILING_MICROS = 100 * MICROS_PER_DOLLAR;

/** One model's list-price rates, in integer micro-dollars per million tokens. */
export interface ModelRate {
    /** Fresh (uncached) input tokens. */
    readonly inputMicrosPerMillionTokens: number;
    /** Generated output tokens. */
    readonly outputMicrosPerMillionTokens: number;
    /**
     * Tokens served from a prompt cache — cheaper than fresh input.
     *
     * ⚠️ UNREACHABLE at this prompt size (ADR-0024 §5): cacheable-prefix minimums are in the low thousands of
     * tokens (4,096 for Claude Haiku 4.5) and this prompt is ~660. The rate exists so the arithmetic stays
     * honest if the prompt ever grows past that threshold, and the worker ALERTS on a non-zero cache field
     * rather than assuming this number is right.
     */
    readonly cacheReadMicrosPerMillionTokens: number;
    /**
     * Tokens written INTO a prompt cache — DEARER than fresh input, which is the trap.
     *
     * ⛔ This is why {@link worstCaseMicros} charges the input budget at the highest of the three input-side
     * rates rather than at {@link ModelRate.inputMicrosPerMillionTokens}. A worst case computed from the fresh
     * rate alone would be EXCEEDED by a call whose whole input budget was a cache write, and a reservation
     * that can be exceeded is not a ceiling.
     */
    readonly cacheWriteMicrosPerMillionTokens: number;
    /** ISO date (`YYYY-MM-DD`) on which this price was recorded. The staleness signal. */
    readonly effectiveDate: string;
    /**
     * Whether the price was READ from a primary source, or assumed.
     *
     * `false` is not a defect — ADR-0024's verification record states plainly that Claude Haiku 4.5's price
     * ON BEDROCK could not be read (the pricing page renders client-side and the Pricing API's Bedrock `model`
     * attribute does not list it), so its figures are computed from Anthropic's first-party rates. Carrying
     * the flag is what keeps that distinction from decaying into "the table says so".
     */
    readonly priceVerified: boolean;
}

/**
 * Bedrock list prices for every model this gate may call.
 *
 * ⛔ MEMBERSHIP IS AUTHORIZATION. A model absent from this table cannot be reserved for and therefore cannot
 * be called, whatever the SSM parameter says — see {@link planReservation}. Adding a model here is the
 * decision to allow it; the bake-off roster is Nova Micro vs Claude Haiku 4.5 and nothing else.
 *
 * ⚠️ Cache rates are derived as multiples of the input rate (0.1x read, 1.25x write), which are the
 * industry-standard discount and the documented 5-minute cache-write premium. They are NOT read from a price
 * list, because the branch that uses them cannot be reached at this prompt size; they exist to keep
 * {@link worstCaseMicros} a true bound rather than to bill anyone.
 */
export const BEDROCK_RATE_TABLE: Readonly<Record<string, ModelRate>> = Object.freeze({
    // Read from the AWS Pricing API on 2026-08-20, us-east-1: $0.035/1M input, $0.14/1M output. Reproduces
    // ADR-0024's $0.27/month figure exactly for ~8,000 calls at ~660/~80 tokens.
    [NOVA_MICRO_MODEL_ID]: Object.freeze({
        inputMicrosPerMillionTokens: 35_000,
        outputMicrosPerMillionTokens: 140_000,
        cacheReadMicrosPerMillionTokens: 3_500,
        cacheWriteMicrosPerMillionTokens: 43_750,
        effectiveDate: '2026-08-20',
        priceVerified: true,
    }),
    // ⚠️ Computed from Anthropic's FIRST-PARTY rates ($1.00/1M input, $5.00/1M output) because the Bedrock
    // price could not be read from a primary source (ADR-0024, "Not verified"). Confirm before the bake-off
    // selects it — and note that a Haiku winner makes every figure in ADR-0024 §3 ~30x larger, including
    // whether $100 is still ~370x headroom.
    [CLAUDE_HAIKU_4_5_MODEL_ID]: Object.freeze({
        inputMicrosPerMillionTokens: 1_000_000,
        outputMicrosPerMillionTokens: 5_000_000,
        cacheReadMicrosPerMillionTokens: 100_000,
        cacheWriteMicrosPerMillionTokens: 1_250_000,
        effectiveDate: '2026-08-20',
        priceVerified: false,
    }),
});

/**
 * The token counts a settled call is costed from.
 *
 * `inputTokens` and `outputTokens` are `Required: Yes` on Bedrock's `TokenUsage`; both cache fields are
 * `Required: No`, so they are optional here and default to zero rather than being read off the response.
 */
export interface TokenUsage {
    readonly inputTokens: number;
    readonly outputTokens: number;
    /** Absent on every call at this prompt size. See {@link ModelRate.cacheReadMicrosPerMillionTokens}. */
    readonly cacheReadInputTokens?: number | undefined;
    /** Absent on every call at this prompt size. See {@link ModelRate.cacheWriteMicrosPerMillionTokens}. */
    readonly cacheWriteInputTokens?: number | undefined;
}

/** Everything a reservation needs to be planned, with no I/O and no clock of its own. */
export interface ReservationRequest {
    /** The Bedrock model id, as read from SSM at cold start. */
    readonly modelId: string;
    /** The live monthly ceiling in micro-dollars, as read from SSM at cold start. */
    readonly ceilingMicros: number;
    /** Layer 1's hard input-token cap. Without it the reservation is a lie (ADR-0024 §2). */
    readonly maxInputTokens: number;
    /** Layer 1's explicit `inferenceConfig.maxTokens`. Same reason. */
    readonly maxOutputTokens: number;
    /** The instant the reservation is taken. Injected so the period key is testable across a month boundary. */
    readonly nowUtc: Date;
}

/**
 * A planned reservation — and the ONLY carrier of the period a settlement may use.
 *
 * ⛔ THE PERIOD IS A FIELD OF THIS OBJECT ON PURPOSE. ADR-0024 §2: "the period key is captured once, at
 * reserve, and carried into settle. Recomputing it at settle time is a real bug" — a call spanning midnight
 * UTC on the 1st would reserve against month M and settle against M+1, leaving M permanently over-reserved
 * and M+1 permanently over-charged. Because settle takes this object, recomputing is not expressible.
 */
export interface PricedReservation {
    readonly kind: 'priced';
    /** `YYYY-MM`, UTC. The counter row's primary key. */
    readonly period: string;
    /** The model this plan prices. Recorded on the verification, per R21/KTD-4. */
    readonly modelId: string;
    /** What is charged to the counter BEFORE the call. */
    readonly worstMicros: number;
    /** `ceiling - worst`. The value the reserve statement's `WHERE` compares the stored total against. */
    readonly headroomMicros: number;
    /** The rates the settlement will be costed at — captured with the plan so a mid-call SSM change cannot split them. */
    readonly rate: ModelRate;
}

/**
 * The outcome of planning a reservation.
 *
 * A discriminated union rather than `ReservationPlan | undefined`, so the unpriced branch can name the model
 * it refused — which is the log line an operator needs when SSM has been pointed at a model nobody priced.
 */
export type ReservationPlan = PricedReservation | { readonly kind: 'unpriced'; readonly modelId: string };

/**
 * The rates for a model id, or `undefined` when the table does not price it.
 *
 * @param modelId - A Bedrock model id.
 * @returns The rate entry, or `undefined`. Pure.
 */
export function rateFor(modelId: string): ModelRate | undefined {
    return Object.hasOwn(BEDROCK_RATE_TABLE, modelId) ? BEDROCK_RATE_TABLE[modelId] : undefined;
}

/**
 * The calendar month an instant falls in, in UTC, as `YYYY-MM`.
 *
 * UTC because that is what AWS bills on, so the counter and layer 5's audit budget agree on where the month
 * boundary is. Zero-padded so keys sort lexicographically.
 *
 * @param nowUtc - The instant to classify.
 * @returns The period key. Pure.
 */
export function periodKey(nowUtc: Date): string {
    const year = nowUtc.getUTCFullYear();
    const month = String(nowUtc.getUTCMonth() + 1).padStart(2, '0');

    return `${year}-${month}`;
}

/**
 * Cost `tokens` at a per-million rate, rounded UP to the next micro-dollar.
 *
 * `Math.ceil` and not `Math.round`: at $0.035/1M a single token costs 0.035 micros, so rounding to nearest
 * would floor a small call to zero and let a runaway made of small calls accumulate real spend against a
 * counter that never moves.
 *
 * @param tokens - Token count (treated as zero when absent).
 * @param microsPerMillionTokens - The rate.
 * @returns Integer micro-dollars. Pure.
 */
function costOf(tokens: number | undefined, microsPerMillionTokens: number): number {
    return Math.ceil(((tokens ?? 0) * microsPerMillionTokens) / TOKENS_PER_RATE_UNIT);
}

/**
 * What a completed call actually cost, from its reported `usage`.
 *
 * Each of the four token classes is costed at its OWN rate; both cache fields default to zero because they
 * are `Required: No` on the wire and unreachable at this prompt size (ADR-0024 §5).
 *
 * @param rate - The model's rates, captured at reserve.
 * @param usage - The response's token counts.
 * @returns Integer micro-dollars. Pure.
 */
export function actualCostMicros(rate: ModelRate, usage: TokenUsage): number {
    return (
        costOf(usage.inputTokens, rate.inputMicrosPerMillionTokens) +
        costOf(usage.outputTokens, rate.outputMicrosPerMillionTokens) +
        costOf(usage.cacheReadInputTokens, rate.cacheReadMicrosPerMillionTokens) +
        costOf(usage.cacheWriteInputTokens, rate.cacheWriteMicrosPerMillionTokens)
    );
}

/**
 * The most one call can possibly cost, given layer 1's two caps.
 *
 * ⛔ The input budget is charged at the HIGHEST input-side rate, not at the fresh-input rate. Cache WRITES
 * cost more per token than fresh input, so a bound taken from the fresh rate alone would be exceeded by a
 * call whose whole input budget was a cache write — and a reservation that can be exceeded is not a ceiling.
 * Every failure mode in ADR-0024 §2 rests on `worst >= actual` holding for EVERY admissible usage.
 *
 * @param rate - The model's rates.
 * @param maxInputTokens - Layer 1's input cap. Input over this is REJECTED, never truncated.
 * @param maxOutputTokens - Layer 1's explicit `inferenceConfig.maxTokens`.
 * @returns Integer micro-dollars. Pure.
 */
export function worstCaseMicros(rate: ModelRate, maxInputTokens: number, maxOutputTokens: number): number {
    const dearestInputRate = Math.max(
        rate.inputMicrosPerMillionTokens,
        rate.cacheReadMicrosPerMillionTokens,
        rate.cacheWriteMicrosPerMillionTokens,
    );

    return costOf(maxInputTokens, dearestInputRate) + costOf(maxOutputTokens, rate.outputMicrosPerMillionTokens);
}

/**
 * The threshold the reserve statement compares the period's ALREADY-STORED total against.
 *
 * ⛔ ADR-0024, Consequences: do not "simplify" this to `ceilingMicros` to make the SQL read more naturally.
 * Subtracting the worst case before the comparison is precisely what bounds reserved spend at the ceiling
 * rather than at `ceiling + one call`. A negative result is correct and meaningful: it denies every call,
 * including the first of a fresh period, when one call cannot fit under the ceiling at all.
 *
 * @param ceilingMicros - The live ceiling.
 * @param worstMicros - This call's worst case.
 * @returns The headroom. Pure.
 */
export function headroomMicros(ceilingMicros: number, worstMicros: number): number {
    return ceilingMicros - worstMicros;
}

/**
 * The amount the settlement adds to `reserved_micros` — normally negative, i.e. a refund.
 *
 * Deliberately UNCLAMPED. A positive delta means the response exceeded the caps the reservation was computed
 * from, and the counter must record the money that actually left rather than quietly absorb it.
 *
 * ⚠️ `reserved + delta` is NOT idempotent, which is why ADR-0024 forbids retrying a settlement: a lost
 * response auto-retried would double-refund most of the reservation, reintroducing exactly the silent
 * under-count reserve-then-settle exists to prevent.
 *
 * @param actualMicros - What the call cost. ZERO for any outcome with no billed response.
 * @param reservedMicros - What was charged before the call.
 * @returns The signed delta. Pure.
 */
export function settleDeltaMicros(actualMicros: number, reservedMicros: number): number {
    return actualMicros - reservedMicros;
}

/**
 * Plan a reservation: resolve the rate, capture the period, and compute the worst case and the headroom.
 *
 * The whole pre-call decision, in one total function with no I/O — which is what lets ADR-0024's ceiling be
 * proved by table test rather than by deploying it and waiting for a runaway.
 *
 * @param request - The model, the live ceiling, both caps, and the instant.
 * @returns A priced plan, or the `unpriced` refusal. Pure.
 */
export function planReservation(request: ReservationRequest): ReservationPlan {
    const rate = rateFor(request.modelId);

    if (rate === undefined) {
        return { kind: 'unpriced', modelId: request.modelId };
    }

    const worstMicros = worstCaseMicros(rate, request.maxInputTokens, request.maxOutputTokens);

    return {
        kind: 'priced',
        period: periodKey(request.nowUtc),
        modelId: request.modelId,
        worstMicros,
        headroomMicros: headroomMicros(request.ceilingMicros, worstMicros),
        rate,
    };
}
