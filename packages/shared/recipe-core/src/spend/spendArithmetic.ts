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
 * Amazon Nova Lite — the next rung of the same family, priced so the bake-off can ask whether Micro is
 * leaving quality on the table.
 *
 * ⚠️ Being priced here is NOT a decision to ship it. {@link BEDROCK_MODEL_REGISTRY} is the authority for what may
 * be CALLED; ADR-0024 §4a's shipped default is still Nova Micro, and moving it is an SSM change plus an ADR.
 * What this entry buys is that a family sweep can be run and costed without inventing a rate.
 */
export const NOVA_LITE_MODEL_ID = 'amazon.nova-lite-v1:0';

/** Amazon Nova Pro — the top of the family sweep. Same caveat as {@link NOVA_LITE_MODEL_ID}. */
export const NOVA_PRO_MODEL_ID = 'amazon.nova-pro-v1:0';

/**
 * Amazon Nova 2 Lite — the model the SHIPPED parse leg calls.
 *
 * ⛔ Unlike the three above, this one IS a shipping decision. It was selected on an external held-out gold
 * set (144 ingredient + 210 instruction lines, human-adjudicated): 84% / 53% exact against Nova Micro's
 * 64% / 30% on the same prompt. Model choice moved accuracy roughly twenty points where eight rounds of
 * prompt revision moved it three.
 */
export const NOVA_2_LITE_MODEL_ID = 'amazon.nova-2-lite-v1:0';

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

/**
 * WHO may claim against the single pool — the closed value space of the `CallSite` metric dimension.
 *
 * ⛔ ATTRIBUTION, NOT PARTITIONING (KTD-17, owner ruling 2026-08-24). There is ONE ceiling,
 * {@link DEFAULT_MONTHLY_CEILING_MICROS}, and it is NOT sub-divided per consumer: a per-`callSite` cap is the
 * daily sub-ceiling's mistake on a different axis — it would refuse a legitimate import while the global
 * figure sat nowhere near $100, and it would need re-tuning every time a consumer's share of the work moved.
 * The accepted consequence, stated so nobody files it as a defect: **the first consumer to burn the pool
 * denies the others**, and the verification gate then fails closed and drains to its DLQ.
 *
 * ⛔ WHICH IS PRECISELY WHY THE NAMES LIVE HERE. Not capping per consumer makes it MORE important to know
 * which one spent, not less — when the pool empties, "who burned it" is the first question, and a
 * dimensionless spend metric cannot answer it. The dimension rides on the METRIC and nowhere else: nothing
 * about the reservation — the ceiling, the worst case, the headroom, or the counter row (keyed on the period
 * ALONE) — may learn about the call site, or one pool silently becomes several of unstated size.
 *
 * ⚠️ It is a CLOSED union because in EMF every distinct combination of dimension values is a separately
 * billed custom metric. The value space is bounded by releases rather than by traffic, which is the property
 * `packages/infra/global/__tests__/emfIdentifierDimensionRepoGate.test.ts` admits `callsite` on — and it is
 * the property `food-service`'s `source-rolling-window-count` lost by carrying `source` with no `stage`, so
 * that prod and every preview co-mingle into one series and no call can be attributed at all.
 */
export const SPEND_CALL_SITES = ['verification-gate', 'ingredient-parse'] as const;

/** One claimant on ADR-0024's single spend pool. */
export type SpendCallSite = (typeof SPEND_CALL_SITES)[number];

/** The ingredient VERIFICATION gate (plan U11, ADR-0024) — the pool's first consumer. */
export const VERIFICATION_GATE_CALL_SITE: SpendCallSite = 'verification-gate';

/**
 * The ingredient-line LLM PARSE leg (plan U18, KTD-17) — the pool's second consumer.
 *
 * ⚠️ Its shape of spend is different from the gate's and that is worth knowing when reading the metric: the
 * gate fires per RESOLVED line and is bounded by how many recipes are written, while the parse leg fires per
 * IMPORTED line and a single bulk import can claim a large share of the month in minutes.
 */
export const INGREDIENT_PARSE_CALL_SITE: SpendCallSite = 'ingredient-parse';

/**
 * Where a decision to route this model's inference beyond the calling region is written down.
 *
 * ⛔ A WARRANT, NOT A BOOLEAN, for the same reason {@link ModelRate.priceVerified} and
 * {@link ModelRate.effectiveDate} exist beside the numbers they qualify: a bare `true` decays into "the table
 * says so" and cannot be audited. Carrying the date and the reference means the diff that first approves a
 * model shows WHAT approved it, in the same commit.
 */
export interface ResidencyApproval {
    /** ISO date (`YYYY-MM-DD`) the approval was granted. */
    readonly approvedOn: string;
    /** Where the decision lives — an ADR id or an FR. */
    readonly reference: string;
}

/**
 * How far an invocation of this model can travel.
 *
 * ⛔ A DISCRIMINATED UNION so that illegal states cannot be written down. An on-demand model CANNOT carry a
 * region list, and a cross-region profile CANNOT omit the date its membership was read. Both were assertions
 * in an earlier draft; as a union they are the compiler's problem instead of a test's.
 *
 * ⚠️ `deploy-region` is a SENTINEL meaning "wherever this invokes", never a region name. A literal here would
 * hardcode a deploy region into a package `@commise/web` and `@commise/mobile` transitively bundle, and would
 * silently make the residency comparison vacuous the first time a stage deployed elsewhere.
 *
 * ⚠️ The region set is a property of the profile AND the calling region, not of the profile alone: AWS
 * documents that `us.anthropic.claude-3-haiku` reaches three regions from us-east-2 but two from us-west-2.
 * `readOn` is what makes a set recorded from another region visible rather than assumed.
 */
export type ModelReach =
    | { readonly kind: 'deploy-region' }
    | {
          readonly kind: 'regions';
          /** Every region this invocation may be routed to, as read from `aws bedrock get-inference-profile`. */
          readonly regions: readonly string[];
          /** ISO date (`YYYY-MM-DD`) that membership was read. The staleness signal. */
          readonly readOn: string;
          /** Absent until residency is decided. See {@link ResidencyApproval}. */
          readonly residencyApproval?: ResidencyApproval | undefined;
      };

/**
 * How Bedrock is ADDRESSED for a model, as distinct from how the model is identified.
 *
 * ⛔ THE TWO IDS ARE NOT THE SAME FACT. `invocationId` is what `Converse` is called with; the registry KEY is
 * what the model IS, and what a verdict and a memo record (R21). They coincide for every on-demand model,
 * which is exactly why one string served both jobs undetected until a profile-only model was rostered.
 * Claude Haiku 4.5 reports `inferenceTypesSupported: ["INFERENCE_PROFILE"]` — its bare id is refused with
 * `ValidationException` and its profile id is not a model id.
 */
export interface ModelInvocation {
    /** The id passed to `Converse`. An inference-profile id for a profile-only model, else the model id. */
    readonly invocationId: string;
    /** How far a call on {@link ModelInvocation.invocationId} can travel. */
    readonly reach: ModelReach;
}

/**
 * One registered model: what it costs, and how it is reached.
 *
 * ⛔ MEMBERSHIP IS AUTHORIZATION (ADR-0024). A model absent from the registry cannot be priced, so it cannot
 * be reserved for, so it cannot be called — whatever SSM says. That is why the address belongs here rather
 * than in a sibling map: a second table could disagree with this one about which models exist, and the
 * disagreement would be silent.
 */
export interface ModelRegistryEntry {
    /** The list-price rates. Deliberately NESTED and unchanged, so the arithmetic still takes only prices. */
    readonly rate: ModelRate;
    /** How Bedrock is addressed for this model. */
    readonly invocation: ModelInvocation;
}

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
 * decision to ALLOW it, which is not the same as the decision to SHIP it: ADR-0024 §4a's shipped default is
 * Nova Micro, and changing that is an SSM parameter plus an ADR, never an edit here.
 *
 * ⚠️ THE ENTRIES DO NOT ALL HAVE THE SAME PROVENANCE, and {@link ModelRate.priceVerified} is where that
 * lives. Cache rates on the two ORIGINAL entries are derived as multiples of the input rate (0.1x read,
 * 1.25x write) — the industry-standard discount and the documented 5-minute cache-write premium — because
 * the branch that uses them cannot be reached at this prompt size; they exist to keep {@link worstCaseMicros}
 * a true bound rather than to bill anyone. The two Nova family additions carry cache rates READ from the
 * Price List API instead, and those two published figures differ from the derived ones in BOTH directions
 * (Nova reads cost 0.25x input, not 0.1x; Nova writes are free, not 1.25x). ⚠️ That mismatch is a live
 * discrepancy against Nova Micro's own derived cache rates, which no longer look like a safe assumption — it
 * is recorded rather than silently corrected, because narrowing a SHIPPED reservation is an ADR-0024 decision
 * and not a side effect of pricing two new models.
 */
export const BEDROCK_MODEL_REGISTRY: Readonly<Record<string, ModelRegistryEntry>> = Object.freeze({
    // Read from the AWS Pricing API on 2026-08-20, us-east-1: $0.035/1M input, $0.14/1M output. Reproduces
    // ADR-0024's $0.27/month figure exactly for ~8,000 calls at ~660/~80 tokens.
    [NOVA_MICRO_MODEL_ID]: Object.freeze({
        rate: Object.freeze({
            inputMicrosPerMillionTokens: 35_000,
            outputMicrosPerMillionTokens: 140_000,
            cacheReadMicrosPerMillionTokens: 3_500,
            cacheWriteMicrosPerMillionTokens: 43_750,
            effectiveDate: '2026-08-20',
            priceVerified: true,
        }),
        invocation: Object.freeze({
            invocationId: NOVA_MICRO_MODEL_ID,
            reach: Object.freeze({ kind: 'deploy-region' } as const),
        }),
    }),
    // ⚠️ Computed from Anthropic's FIRST-PARTY rates ($1.00/1M input, $5.00/1M output) because the Bedrock
    // price could not be read from a primary source (ADR-0024, "Not verified"). Confirm before the bake-off
    // selects it — and note that a Haiku winner makes every figure in ADR-0024 §3 ~30x larger, including
    // whether $100 is still ~370x headroom.
    [CLAUDE_HAIKU_4_5_MODEL_ID]: Object.freeze({
        rate: Object.freeze({
            inputMicrosPerMillionTokens: 1_000_000,
            outputMicrosPerMillionTokens: 5_000_000,
            cacheReadMicrosPerMillionTokens: 100_000,
            cacheWriteMicrosPerMillionTokens: 1_250_000,
            effectiveDate: '2026-08-20',
            priceVerified: false,
        }),
        // ⛔ INFERENCE_PROFILE-ONLY. The bare id is refused: "Invocation of model ID … with on-demand
        // throughput isn't supported" (verified against the live account, 2026-08-23). Regions read from
        // `aws bedrock get-inference-profile` FROM us-east-1 on that date; the set is a property of the
        // profile AND the calling region, which is what `readOn` exists to expose.
        // ⚠️ NO `residencyApproval` — AWS stores prompts and outputs in destination Regions for abuse
        // detection, so routing recipe text there is an open question (016), not a config detail.
        invocation: Object.freeze({
            invocationId: `us.${CLAUDE_HAIKU_4_5_MODEL_ID}`,
            reach: Object.freeze({
                kind: 'regions',
                regions: Object.freeze(['us-east-1', 'us-east-2', 'us-west-2']),
                readOn: '2026-08-23',
            } as const),
        }),
    }),
    // ⛔ READ 2026-08-23 from the AWS Price List API — the PRIMARY source, and the same query that reproduces
    // Nova Micro's committed figures exactly:
    //   aws pricing get-products --service-code AmazonBedrock --region us-east-1 \
    //     --filters Type=TERM_MATCH,Field=model,Value="Nova Lite" \
    //               Type=TERM_MATCH,Field=regionCode,Value=us-east-1
    // `feature: On-demand Inference`, publicationDate 2026-08-20, effectiveDate 2026-08-01, us-east-1:
    //   input $0.00006/1K · output $0.00024/1K · cache read $0.000015/1K · cache write $0.00/1K.
    // ⚠️ Every price on this entry — cache rates INCLUDED — is read, not derived. `aws.amazon.com/bedrock/
    // pricing/` renders its tables client-side and cannot be fetched, which is why the Price List API is the
    // source of record here as it was for Nova Micro.
    // ⛔ READ FROM THE AWS PRICING API on 2026-08-27, us-east-1 (`USE1-Nova2.0Lite-*`), not derived from the
    // Nova family pattern — this registry's own docstring records that the family's cache rates differ from
    // the derived ones in BOTH directions, so inheriting them is the mistake it warns about.
    //
    // ⚠️ The `flex` service tier prices every one of these at exactly HALF (`-flex` usage types) and, unlike
    // BATCH, keeps prompt caching: measured live 2026-08-27, `serviceTier: {type:'flex'}` is accepted, echoed
    // back, and reports the same `cacheReadInputTokens`. AWS documents caching as on-demand-only and NOT
    // supported with the batch inference API, so flex is the only 50% path that keeps the cache.
    [NOVA_2_LITE_MODEL_ID]: Object.freeze({
        rate: Object.freeze({
            inputMicrosPerMillionTokens: 330_000,
            outputMicrosPerMillionTokens: 2_750_000,
            cacheReadMicrosPerMillionTokens: 82_500,
            // ⛔ Published ZERO, like every other Nova — `cache-write-input-token-count` = $0.0000000000/1K.
            // Verified for THIS model rather than inherited.
            cacheWriteMicrosPerMillionTokens: 0,
            effectiveDate: '2026-08-27',
            priceVerified: true,
        }),
        // ⛔ INFERENCE_PROFILE-only: `aws bedrock get-foundation-model` reports
        // inferenceTypesSupported = ["INFERENCE_PROFILE"], so the bare id is refused at call time.
        //
        // ⛔ AND EVERY PROFILE THAT EXISTS LEAVES THE DEPLOY REGION. `aws bedrock list-inference-profiles`
        // (us-east-1, 2026-08-27) returns exactly two for this model — `us.` over three US regions, and
        // `global.` which reaches wider still. There is no single-region profile and no application profile,
        // so this model CANNOT be called without routing recipe text out of us-east-1.
        //
        // ⚠️ NO `residencyApproval`, exactly as for Claude Haiku 4.5 and for the same reason: AWS stores
        // prompts and outputs in destination Regions for abuse detection, so routing user recipe text there
        // is an open question owned by 016 — not a config detail, and not mine to close by editing a marker.
        // `residencyClearance` therefore answers `unapproved`, which the runtime gate and the CDK IAM grant
        // both honour. Selecting this model on accuracy does not make it callable.
        invocation: Object.freeze({
            invocationId: 'us.amazon.nova-2-lite-v1:0',
            reach: Object.freeze({
                kind: 'regions',
                regions: Object.freeze(['us-east-1', 'us-east-2', 'us-west-2']),
                readOn: '2026-08-27',
            } as const),
        }),
    }),
    [NOVA_LITE_MODEL_ID]: Object.freeze({
        rate: Object.freeze({
            inputMicrosPerMillionTokens: 60_000,
            outputMicrosPerMillionTokens: 240_000,
            cacheReadMicrosPerMillionTokens: 15_000,
            // ⛔ ZERO IS THE PUBLISHED RATE, not a missing value: the Nova family bills nothing for cache WRITES
            // (`USE1-NovaLite-cache-write-input-token-count` = $0.0000000000/1K). It collapses `worstCaseMicros`'
            // dearest-input rate onto the fresh input rate, which is still a TRUE bound — Bedrock defines total
            // input as `inputTokens + cacheReadInputTokens + cacheWriteInputTokens`, so every partition of layer
            // 1's input cap costs at most the cap charged entirely as fresh input. Asserted over the whole table.
            cacheWriteMicrosPerMillionTokens: 0,
            effectiveDate: '2026-08-23',
            priceVerified: true,
        }),
        invocation: Object.freeze({
            invocationId: NOVA_LITE_MODEL_ID,
            reach: Object.freeze({ kind: 'deploy-region' } as const),
        }),
    }),
    // Same query and same source as Nova Lite, `Value="Nova Pro"`: input $0.0008/1K · output $0.0032/1K ·
    // cache read $0.0002/1K · cache write $0.00/1K.
    // ⚠️ Nova Pro ALSO publishes `flex` (0.5x) and `priority` (1.75x) service-tier dimensions. These are the
    // STANDARD on-demand rates, which is what a `Converse` call with no service tier is billed at; pricing a
    // flex or priority run off this entry would be wrong in both directions.
    [NOVA_PRO_MODEL_ID]: Object.freeze({
        rate: Object.freeze({
            inputMicrosPerMillionTokens: 800_000,
            outputMicrosPerMillionTokens: 3_200_000,
            cacheReadMicrosPerMillionTokens: 200_000,
            // See the Nova Lite entry — published zero, not an omission.
            cacheWriteMicrosPerMillionTokens: 0,
            effectiveDate: '2026-08-23',
            priceVerified: true,
        }),
        invocation: Object.freeze({
            invocationId: NOVA_PRO_MODEL_ID,
            reach: Object.freeze({ kind: 'deploy-region' } as const),
        }),
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
    /**
     * The id `Converse` is ADDRESSED with — {@link ModelInvocation.invocationId}, resolved when the plan was
     * priced.
     *
     * ⛔ NOT {@link PricedReservation.modelId}, and the distinction is the whole of U35. `modelId` is what the
     * model IS: the registry key, the `model_id` on a verdict and the `verified_by` on a memo. This is how it
     * is REACHED. They coincide for every on-demand model — which is exactly why one string served both jobs
     * undetected until a profile-only model was rostered, and why re-deriving one from the other at the call
     * site is the defect rather than a simplification.
     *
     * It rides on the plan for the same reason {@link PricedReservation.rate} and
     * {@link PricedReservation.period} do: a mid-call SSM change cannot split the id that was PRICED from the
     * id that was CALLED if both were captured in one read of the registry.
     */
    readonly invocationId: string;
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
    return Object.hasOwn(BEDROCK_MODEL_REGISTRY, modelId) ? BEDROCK_MODEL_REGISTRY[modelId]?.rate : undefined;
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
/**
 * The registered model, or `undefined` when the registry does not know the id.
 *
 * ⛔ `undefined` IS the refusal. ADR-0024's membership-is-authorization rule means an unregistered id has no
 * worst case, so it can never be reserved for and never be called. Pure.
 *
 * @param modelId - A Bedrock model id, as read from SSM.
 * @returns The registry entry, or `undefined`.
 */
export function registryEntryFor(modelId: string): ModelRegistryEntry | undefined {
    return Object.hasOwn(BEDROCK_MODEL_REGISTRY, modelId) ? BEDROCK_MODEL_REGISTRY[modelId] : undefined;
}

/** What residency has to say about invoking one entry from one region. */
export type ResidencyClearance = 'in-deploy-region' | 'approved' | 'unapproved';

/**
 * Decide whether this entry may be invoked from this region on residency grounds. Pure and total.
 *
 * ⛔ THE ONLY INTERPRETER OF THE MARKER, called by BOTH the runtime gate and the CDK stack that derives the
 * IAM grant. Two interpreters of one fact would drift, and drift in the dangerous direction — IAM granting
 * what the runtime refuses, or the reverse. One predicate, two callers, no second opinion.
 *
 * ⚠️ `in-deploy-region` is returned for a recorded region set that does not actually leave the deploy region,
 * not only for the sentinel. A profile whose members are all local needs no warrant, and demanding one would
 * be ceremony rather than a control.
 *
 * @param entry - The registered model.
 * @param deployRegion - The region the caller invokes from.
 * @returns Whether the call stays local, is approved to leave, or is refused.
 */
export function residencyClearance(entry: ModelRegistryEntry, deployRegion: string): ResidencyClearance {
    const { reach } = entry.invocation;

    if (reach.kind === 'deploy-region') {
        return 'in-deploy-region';
    }

    if (reach.regions.every((region) => region === deployRegion)) {
        return 'in-deploy-region';
    }

    return reach.residencyApproval === undefined ? 'unapproved' : 'approved';
}

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
    // ⛔ ONE read of the registry, yielding BOTH the price and the address. Resolving them separately — a
    // `rateFor` here and an invocation lookup at the call site — is what allows a model to be priced under one
    // identity and invoked under another.
    const entry = registryEntryFor(request.modelId);

    if (entry === undefined) {
        return { kind: 'unpriced', modelId: request.modelId };
    }

    const { rate } = entry;
    const worstMicros = worstCaseMicros(rate, request.maxInputTokens, request.maxOutputTokens);

    return {
        kind: 'priced',
        period: periodKey(request.nowUtc),
        modelId: request.modelId,
        invocationId: entry.invocation.invocationId,
        worstMicros,
        headroomMicros: headroomMicros(request.ceilingMicros, worstMicros),
        rate,
    };
}
