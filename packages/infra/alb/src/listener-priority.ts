/**
 * THE allocation authority for shared-ALB listener-rule priorities (ADR-0003). One module, one registry,
 * one resolver — every service stack imports; none restates.
 *
 * ## The namespace, and why it needs an owner
 *
 * Each stage has exactly ONE internet-facing ALB, and every service attaches a host-based
 * `ApplicationListenerRule` to its single HTTPS listener. A listener cannot hold two rules at the same
 * priority, so priority is a namespace SHARED across independently-deployed CloudFormation stacks — and
 * nothing in AWS or CDK arbitrates it. A collision surfaces only at deploy, as
 * `Priority 'N' is currently in use`, which does not name the other claimant.
 *
 * That namespace was previously allocated by a copy-pasted pair of constants plus a resolver in EACH service
 * stack, and it drifted exactly as duplicated knowledge does: recipe's resolver docstring described food's
 * bands, so following the prose put `recipe-pr-{N}` on `food-pr-{N}`'s priority. Five services would have
 * meant five copies. The knowledge "which priority does this service+stage get" has one reason to change, so
 * it gets one representation, here.
 *
 * ## The geometry
 *
 * AWS admits priorities **1–50000** (`ALB_MAX_LISTENER_PRIORITY`; verified against AWS's listener-rule
 * documentation). ⚠️ `aws-cdk-lib` validates only `priority >= 1` — the CEILING is NOT checked at synth — so
 * an overflow would otherwise reach CloudFormation. This module range-checks its own output instead.
 *
 * The range is partitioned into three adjacent spans, then each ephemeral span into one fixed-width BAND per
 * reserved service slot:
 *
 * | Span     | Range         | Allocated by                     | Per slot            |
 * | -------- | ------------- | -------------------------------- | ------------------- |
 * | base     | 1 – 999       | {@link BASE_LISTENER_PRIORITY}    | one fixed number    |
 * | named    | 1000 – 1999   | registry index                   | 125 (`pr`-free)     |
 * | per-PR   | 2000 – 49999  | PR number                        | 6000                |
 *
 * With {@link EPHEMERAL_SERVICE_SLOTS} = 8 the per-PR bands are 2000–7999, 8000–13999, 14000–19999, …,
 * 44000–49999 — so the 5-service near-term roster tops out at 31999 and the full 8-service roster lands
 * exactly on 49999. Slots 3–7 are unclaimed today; a new service appends itself to
 * {@link EPHEMERAL_SLOT_ORDER} and takes the next one, RENUMBERING NOTHING.
 *
 * ## Why bands rather than interleaving by stride
 *
 * A stride scheme (`floor + N * stride + slot`) holds the same total capacity — it is the arithmetic dual —
 * but its overflow behaviour is worse. At `slot === stride` a stride scheme SILENTLY ALIASES onto slot 0 of
 * the next PR (`floor + N*8 + 8 === floor + (N+1)*8 + 0`), i.e. a real, live priority belonging to another
 * service. The band scheme's ninth slot instead computes past 49999, which is out of range and therefore
 * *detectable absolutely* — which is what {@link assertWithinAlbRange} does, at synth. Bands also make a
 * failed deploy's opaque number decodable by range (8073 → food's band → `food-pr-73`) instead of by modular
 * arithmetic. Capacity is marginally better too: a 6000-wide band admits PRs up to 5999, where stride-8 over
 * the same span admits ~4875.
 *
 * ## The ceilings, stated honestly
 *
 * - **PR number < 6000.** At PR ~91 that is ~65× headroom, and it is a REDUCTION from the old 10000-wide
 *   band — the price of fitting more than two feature services at all. Past it, allocation THROWS; it never
 *   wraps, because a wrap is a silent collision. Raising it later means narrowing a band and renumbering the
 *   ephemeral bands — cheap, because per-PR rules are destroyed and recreated with their PR, and base
 *   priorities do not move.
 * - **8 services.** A 9th needs the geometry re-cut (fewer PRs per band, or a second listener). It fails at
 *   synth, loudly, rather than colliding.
 *
 * @module
 */

/** The lowest priority an ALB listener rule may carry. */
export const ALB_MIN_LISTENER_PRIORITY = 1;

/**
 * The highest priority an ALB listener rule may carry.
 *
 * AWS's documented range is 1–50000. `aws-cdk-lib`'s `ApplicationListenerRule` rejects `priority <= 0` and
 * says nothing about the upper bound, so exceeding this is a DEPLOY-time failure unless we catch it — see
 * {@link assertWithinAlbRange}.
 */
export const ALB_MAX_LISTENER_PRIORITY = 50_000;

/** Top of the span reserved for the FIXED per-service base-stage priorities (prod/sandbox). */
export const BASE_SPAN_CEILING = 999;

/** Bottom of the span reserved for REGISTERED named ephemeral stages. */
export const NAMED_SPAN_FLOOR = 1_000;

/** Top of the named-ephemeral span. */
export const NAMED_SPAN_CEILING = 1_999;

/** Bottom of the span reserved for `pr-{N}` previews. */
export const PER_PR_SPAN_FLOOR = 2_000;

/** Top of the per-PR span — one below the ALB ceiling, so 50000 itself stays unused and unambiguous. */
export const PER_PR_SPAN_CEILING = ALB_MAX_LISTENER_PRIORITY - 1;

/**
 * How many services the ephemeral geometry reserves a band for.
 *
 * Sized for the near-term roster of five (identity + four feature services) with room to double it. Every
 * slot is reserved whether or not a service claims it, which is the point: services 4–8 arrive without
 * renumbering anything already deployed.
 */
export const EPHEMERAL_SERVICE_SLOTS = 8;

/**
 * Width of one service's per-PR band, and therefore the EXCLUSIVE ceiling on a PR number.
 *
 * `EPHEMERAL_SERVICE_SLOTS * PER_PR_BAND_WIDTH` must equal the per-PR span exactly — too wide overhangs the
 * ALB ceiling, too narrow leaves an unallocated gap. Asserted in `__tests__/listener-priority.test.ts`.
 */
export const PER_PR_BAND_WIDTH = 6_000;

/** Width of one service's named band, and therefore the maximum size of {@link NAMED_EPHEMERAL_STAGES}. */
export const NAMED_BAND_WIDTH = 125;

/**
 * Every service that attaches a rule to the shared listener, in EPHEMERAL SLOT ORDER.
 *
 * A service's ephemeral slot is its INDEX in this tuple, which is what makes two services sharing a slot
 * structurally impossible rather than merely tested-against. Consequences:
 *
 * - **APPEND ONLY.** Reordering re-cuts every ephemeral band. That is survivable (per-PR rules are ephemeral
 *   and get replaced on the next deploy) but pointless, and it churns every open PR's listener rule.
 * - Base priorities are NOT derived from this order — they live in {@link BASE_LISTENER_PRIORITY} as explicit
 *   values, so a reorder cannot silently move a PROD rule.
 *
 * `identity` holds slot 0 and never uses it: it is the one shared persistent service every preview signs in
 * against, so it has no per-PR deploy. Reserving its band anyway keeps the registry uniform (no
 * "base-only service" special case) and costs one of eight slots.
 */
export const EPHEMERAL_SLOT_ORDER = ['identity', 'food', 'recipe'] as const;

/** A service registered in {@link EPHEMERAL_SLOT_ORDER}. */
export type SharedListenerService = (typeof EPHEMERAL_SLOT_ORDER)[number];

/**
 * The FIXED listener-rule priority each service uses on a base stage (prod, and sandbox where it exists).
 *
 * These are live, deployed rule priorities. Changing one replaces a rule on a shared production listener, so
 * they are written out explicitly rather than derived from slot order, and pinned by a test. The `Record` key
 * type is {@link SharedListenerService}, so a service registered in the tuple without a base priority (or
 * vice versa) is a COMPILE error, not a drift.
 */
export const BASE_LISTENER_PRIORITY: Readonly<Record<SharedListenerService, number>> = {
    identity: 100,
    food: 200,
    recipe: 300,
};

/**
 * Every named (non-`pr-{N}`, non-base) stage that may be synthesized, in slot order.
 *
 * ⛔ THIS IS A REGISTRY, NOT A HASH, AND THAT IS THE POINT. The previous scheme hashed the stage string into
 * a band and documented its own residual: "two *distinct, concurrently deployed* named stages could still
 * collide". A hash collision cannot be detected at synth — each stack synthesizes alone and cannot know what
 * other stages exist — so it could only ever surface as an opaque `Priority 'N' is currently in use` at
 * deploy. An index into this list makes the collision IMPOSSIBLE instead of unlikely.
 *
 * The accepted cost: a genuinely new named stage is a one-line edit here, and an unregistered name fails at
 * synth with a message that says so. `dev` is load-bearing — it is the `?? 'dev'` fallback every service's
 * `infra/bin/app.ts` uses when no `STAGE` is given, so a bare local `cdk synth` lands on it. `test` and
 * `local` are the other non-deployed sentinels this repo already recognises.
 */
export const NAMED_EPHEMERAL_STAGES = ['dev', 'test', 'local'] as const;

/** An inclusive priority range. */
export interface PriorityBand {
    /** Lowest priority in the band. */
    readonly floor: number;
    /** Highest priority in the band, inclusive. */
    readonly ceiling: number;
}

/** The two ephemeral bands belonging to one service slot. */
export interface EphemeralBands {
    /** Where this slot's `pr-{N}` rules live. */
    readonly perPr: PriorityBand;
    /** Where this slot's registered named-stage rules live. */
    readonly named: PriorityBand;
}

/** Everything needed to resolve one rule's priority. An object, so `stage`/`baseStage` cannot be swapped. */
export interface ListenerPriorityRequest {
    /** The service claiming the rule. */
    readonly service: SharedListenerService;
    /** The deploy stage (`prod`, `sandbox`, `pr-{N}`, or a registered named stage). */
    readonly stage: string;
    /** The persistent platform stage this deploy rides (ADR-0006): prod → prod, else → sandbox. */
    readonly baseStage: string;
}

/**
 * Only an unpadded, non-zero decimal — so `pr-7` is the ONE spelling that maps to 7.
 *
 * `pr-007` and `pr-7` are different stage strings, and a permissive `\d+` parses both to 7, putting two
 * stacks on one priority. `pr-0` is not a PR number at all. Both fall through to the named branch and are
 * rejected there, which is the loud outcome; a lenient parse would be the silent one.
 */
const PR_STAGE = /^pr-([1-9]\d*)$/;

/**
 * Resolve the two ephemeral bands reserved for a service slot. Pure.
 *
 * Exported because it is the geometry itself: it is what a human decodes an opaque
 * `Priority 'N' is currently in use` with, and what the disjointness suite enumerates over — including the
 * slots no service has claimed yet, which is the only way to prove services 4–8 will not collide.
 *
 * @param slot - A service's ephemeral slot, i.e. its index in {@link EPHEMERAL_SLOT_ORDER}.
 * @returns The slot's inclusive per-PR and named bands.
 * @throws If `slot` is not an integer in `[0, EPHEMERAL_SERVICE_SLOTS)`.
 */
export function ephemeralBandsForSlot(slot: number): EphemeralBands {
    if (!Number.isInteger(slot) || slot < 0 || slot >= EPHEMERAL_SERVICE_SLOTS) {
        throw new Error(
            `Shared-ALB listener priority: ephemeral slot ${slot} is outside the reserved range ` +
                `[0, ${EPHEMERAL_SERVICE_SLOTS}). The geometry reserves ${EPHEMERAL_SERVICE_SLOTS} service ` +
                'bands; a further service needs the spans in listener-priority.ts re-cut (narrower bands, ' +
                'i.e. a lower PR ceiling), not a slot outside them.',
        );
    }

    const perPrFloor = PER_PR_SPAN_FLOOR + slot * PER_PR_BAND_WIDTH;
    const namedFloor = NAMED_SPAN_FLOOR + slot * NAMED_BAND_WIDTH;

    return {
        perPr: { floor: perPrFloor, ceiling: perPrFloor + PER_PR_BAND_WIDTH - 1 },
        named: { floor: namedFloor, ceiling: namedFloor + NAMED_BAND_WIDTH - 1 },
    };
}

/**
 * Fail fast if a computed priority is outside what AWS accepts. Pure.
 *
 * The last line of defence, and it exists because `aws-cdk-lib` does not check the 50000 ceiling: without
 * this, a geometry edit that overflows would synth cleanly and fail during `cdk deploy`, halfway through a
 * stack update.
 *
 * @param priority - The computed priority.
 * @param context - What was being allocated, for the message.
 * @returns The priority, unchanged.
 * @throws If the priority is outside `[ALB_MIN_LISTENER_PRIORITY, ALB_MAX_LISTENER_PRIORITY]`.
 */
function assertWithinAlbRange(priority: number, context: string): number {
    if (priority < ALB_MIN_LISTENER_PRIORITY || priority > ALB_MAX_LISTENER_PRIORITY) {
        throw new Error(
            `Shared-ALB listener priority ${priority} for ${context} is outside the range AWS accepts ` +
                `(${ALB_MIN_LISTENER_PRIORITY}–${ALB_MAX_LISTENER_PRIORITY}). aws-cdk-lib does not check the ` +
                'ceiling, so this would have failed during cdk deploy instead of at synth.',
        );
    }

    return priority;
}

/**
 * Resolve the shared-ALB listener-rule priority for one service at one stage. Pure and total for the inputs
 * it accepts; it throws rather than returning a colliding value for any it does not.
 *
 * Three branches, in three disjoint spans:
 *
 * 1. **Base stage** (`stage === baseStage`) → the service's fixed {@link BASE_LISTENER_PRIORITY}. This is the
 *    only branch prod ever takes, and its value is unchanged from the pre-registry allocation, so prod's
 *    synthesized template does not diff.
 * 2. **`pr-{N}`** → the service's per-PR band floor + N. Keyed off the globally unique PR number, so two
 *    previews of the same service cannot collide either.
 * 3. **A registered named stage** → the service's named band floor + the stage's registry index.
 *
 * @param request - The service, its stage, and the base stage it rides.
 * @returns A priority unique across every rule on the shared listener.
 * @throws If the PR number does not fit the band, or the stage is neither a base stage, a well-formed
 *   `pr-{N}`, nor a stage registered in {@link NAMED_EPHEMERAL_STAGES}.
 */
export function listenerPriorityForStage(request: ListenerPriorityRequest): number {
    const { service, stage, baseStage } = request;

    if (stage === baseStage) {
        return assertWithinAlbRange(BASE_LISTENER_PRIORITY[service], `${service} at base stage '${stage}'`);
    }

    const bands = ephemeralBandsForSlot(EPHEMERAL_SLOT_ORDER.indexOf(service));
    const prNumber = PR_STAGE.exec(stage)?.[1];

    if (prNumber !== undefined) {
        const number = Number(prNumber);

        if (number >= PER_PR_BAND_WIDTH) {
            throw new Error(
                `Shared-ALB listener priority: PR number ${number} does not fit ${service}'s per-PR band ` +
                    `(width ${PER_PR_BAND_WIDTH}, so PR numbers 1–${PER_PR_BAND_WIDTH - 1}). The scheme ` +
                    'refuses to wrap, because a wrapped priority is a silent collision with another PR. ' +
                    'Widening this means re-cutting the spans in listener-priority.ts.',
            );
        }

        return assertWithinAlbRange(bands.perPr.floor + number, `${service} at stage '${stage}'`);
    }

    // `findIndex`, not `indexOf`, so the arbitrary `stage` string needs no cast into the registry's union.
    const namedIndex = NAMED_EPHEMERAL_STAGES.findIndex((registered) => registered === stage);

    if (namedIndex < 0) {
        throw new Error(
            `Shared-ALB listener priority: stage '${stage}' is not a base stage ('${baseStage}'), not a ` +
                "well-formed 'pr-{N}' (unpadded, non-zero), and is not registered in " +
                `NAMED_EPHEMERAL_STAGES (${NAMED_EPHEMERAL_STAGES.join(', ')}). Named stages are allocated ` +
                'from that registry rather than hashed, so that two concurrently deployed named stages ' +
                'CANNOT collide; add the stage there to give it a slot.',
        );
    }

    return assertWithinAlbRange(bands.named.floor + namedIndex, `${service} at named stage '${stage}'`);
}
