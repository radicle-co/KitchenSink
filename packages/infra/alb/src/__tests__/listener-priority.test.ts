/**
 * The shared-ALB listener-rule priority namespace, proven DISJOINT rather than spot-checked.
 *
 * Every rule on a stage's one shared HTTPS listener (ADR-0003) draws from a single 1–50000 priority
 * namespace, and two rules with the same priority is a deploy failure (`Priority 'N' is currently in use`)
 * that CloudFormation reports without saying who the other claimant is. The allocation therefore has exactly
 * one property worth proving, and it is a property over ALL inputs, not over three examples: **no two
 * (service, stage) pairs the scheme can ever be asked about map to the same priority.**
 *
 * So the disjointness suites below ENUMERATE the namespace — every reserved service slot × every PR number
 * the band admits × every named-stage slot × every registered base priority — into one Set, and assert the
 * cardinality. Each starts by asserting the size of what it enumerated, because a property test over an
 * accidentally-empty range passes vacuously and would have hidden exactly the drift this replaces (recipe's
 * resolver docstring carried food's band values; a suite that checked `pr-73` for one service at a time could
 * not see it).
 *
 * @module
 */
import { describe, expect, it } from 'vitest';

import {
    ALB_MAX_LISTENER_PRIORITY,
    ALB_MIN_LISTENER_PRIORITY,
    BASE_LISTENER_PRIORITY,
    BASE_SPAN_CEILING,
    EPHEMERAL_SERVICE_SLOTS,
    EPHEMERAL_SLOT_ORDER,
    NAMED_BAND_WIDTH,
    NAMED_EPHEMERAL_STAGES,
    NAMED_SPAN_CEILING,
    NAMED_SPAN_FLOOR,
    PER_PR_BAND_WIDTH,
    PER_PR_SPAN_CEILING,
    PER_PR_SPAN_FLOOR,
    ephemeralBandsForSlot,
    listenerPriorityForStage,
} from '../listener-priority.js';

/** Every slot the geometry reserves, registered to a service today or not. */
const RESERVED_SLOTS = Array.from({ length: EPHEMERAL_SERVICE_SLOTS }, (_, slot) => slot);

/** Every PR number the per-PR band admits, i.e. the full domain of the `pr-{N}` branch. */
const EVERY_ADMITTED_PR = Array.from({ length: PER_PR_BAND_WIDTH - 1 }, (_, index) => index + 1);

// ── The geometry: it must partition 1–50000 with no gap, no overlap, and no slack ─────────────────
describe('the priority namespace geometry', () => {
    it('uses the AWS-documented bounds for an ALB listener-rule priority', () => {
        // Verified against AWS's own listener-rule documentation: "you can enter a priority value from
        // 1-50,000". aws-cdk-lib validates only `priority >= 1` — the CEILING is unchecked at synth, which is
        // why this module asserts it itself rather than trusting CDK to catch an overflow.
        expect(ALB_MIN_LISTENER_PRIORITY).toBe(1);
        expect(ALB_MAX_LISTENER_PRIORITY).toBe(50_000);
    });

    it('partitions the whole range into three ADJACENT spans — base, named, per-PR — with no gap', () => {
        expect(BASE_SPAN_CEILING + 1).toBe(NAMED_SPAN_FLOOR);
        expect(NAMED_SPAN_CEILING + 1).toBe(PER_PR_SPAN_FLOOR);
        expect(PER_PR_SPAN_CEILING).toBe(ALB_MAX_LISTENER_PRIORITY - 1);
    });

    it('divides the per-PR span EXACTLY among the reserved slots — no slack, no overhang', () => {
        // ⛔ MUTATION GUARD: PER_PR_BAND_WIDTH off by one in either direction reds here. Too wide overhangs
        // the ALB ceiling (and overlaps the next slot); too narrow leaves an unallocated gap, which is how a
        // later "we have room, just shift it" edit walks into another slot's band.
        const perPrSpanSize = PER_PR_SPAN_CEILING - PER_PR_SPAN_FLOOR + 1;

        expect(perPrSpanSize).toBe(48_000);
        expect(EPHEMERAL_SERVICE_SLOTS * PER_PR_BAND_WIDTH).toBe(perPrSpanSize);
    });

    it('divides the named span EXACTLY among the reserved slots', () => {
        const namedSpanSize = NAMED_SPAN_CEILING - NAMED_SPAN_FLOOR + 1;

        expect(namedSpanSize).toBe(1_000);
        expect(EPHEMERAL_SERVICE_SLOTS * NAMED_BAND_WIDTH).toBe(namedSpanSize);
    });

    it('keeps every registered service inside the reserved slot count', () => {
        expect(EPHEMERAL_SLOT_ORDER.length).toBeGreaterThan(0);
        expect(EPHEMERAL_SLOT_ORDER.length).toBeLessThanOrEqual(EPHEMERAL_SERVICE_SLOTS);
    });

    it('keeps every registered named stage inside one named band', () => {
        expect(NAMED_EPHEMERAL_STAGES.length).toBeGreaterThan(0);
        expect(NAMED_EPHEMERAL_STAGES.length).toBeLessThanOrEqual(NAMED_BAND_WIDTH);
    });

    it('refuses a slot outside the reserved range instead of computing a priority past the ceiling', () => {
        expect(() => ephemeralBandsForSlot(EPHEMERAL_SERVICE_SLOTS)).toThrow(/slot/i);
        expect(() => ephemeralBandsForSlot(-1)).toThrow(/slot/i);
    });
});

// ── The registry: the ONE authority, and the values prod actually runs on ─────────────────────────
describe('the service registry', () => {
    it('names each service exactly once, so a slot cannot be claimed twice', () => {
        // The ephemeral slot IS the index in this tuple, so two services sharing a slot is structurally
        // impossible — but one service listed twice would orphan a slot and mislead every reader.
        expect(new Set(EPHEMERAL_SLOT_ORDER).size).toBe(EPHEMERAL_SLOT_ORDER.length);
    });

    it('gives every registered service a DISTINCT base priority', () => {
        // ⛔ MUTATION GUARD: set two services' base priorities equal (e.g. recipe: 200) and this reds. That
        // collision would land on the shared PROD listener, which is the expensive half of this namespace.
        const basePriorities = EPHEMERAL_SLOT_ORDER.map((service) => BASE_LISTENER_PRIORITY[service]);

        expect(basePriorities).toHaveLength(EPHEMERAL_SLOT_ORDER.length);
        expect(new Set(basePriorities).size).toBe(basePriorities.length);
    });

    it('keeps every base priority inside the base span, clear of both ephemeral spans', () => {
        for (const service of EPHEMERAL_SLOT_ORDER) {
            expect(BASE_LISTENER_PRIORITY[service]).toBeGreaterThanOrEqual(ALB_MIN_LISTENER_PRIORITY);
            expect(BASE_LISTENER_PRIORITY[service]).toBeLessThanOrEqual(BASE_SPAN_CEILING);
        }
    });

    it('PINS the three live base priorities — these are deployed rules, and a change replaces them', () => {
        // identity=100, food=200, recipe=300 are what prod's synthesized template contains today. This
        // assertion is the prod-diff guard: reordering the registry or "tidying" a base priority reds here
        // before it reaches a live listener.
        expect(BASE_LISTENER_PRIORITY).toEqual({ identity: 100, food: 200, recipe: 300 });
    });

    it('registers each named ephemeral stage exactly once', () => {
        expect(new Set(NAMED_EPHEMERAL_STAGES).size).toBe(NAMED_EPHEMERAL_STAGES.length);
    });

    it('registers no named stage that the pr-{N} branch would have claimed first', () => {
        for (const stage of NAMED_EPHEMERAL_STAGES) {
            expect(stage).not.toMatch(/^pr-\d+$/);
        }
    });
});

// ── Behaviour, per branch, including every failure path ───────────────────────────────────────────
describe('listenerPriorityForStage', () => {
    it('returns the registered base priority when the stage IS its base stage', () => {
        expect(listenerPriorityForStage({ service: 'identity', stage: 'prod', baseStage: 'prod' })).toBe(100);
        expect(listenerPriorityForStage({ service: 'food', stage: 'prod', baseStage: 'prod' })).toBe(200);
        expect(listenerPriorityForStage({ service: 'recipe', stage: 'prod', baseStage: 'prod' })).toBe(300);
        expect(listenerPriorityForStage({ service: 'food', stage: 'sandbox', baseStage: 'sandbox' })).toBe(200);
    });

    it('places a pr-{N} stage at its own slot band floor plus N', () => {
        for (const service of EPHEMERAL_SLOT_ORDER) {
            const slot = EPHEMERAL_SLOT_ORDER.indexOf(service);
            const { perPr } = ephemeralBandsForSlot(slot);

            expect(listenerPriorityForStage({ service, stage: 'pr-73', baseStage: 'sandbox' })).toBe(perPr.floor + 73);
        }
    });

    it('places a registered named stage in the named band, never the per-PR band', () => {
        for (const service of EPHEMERAL_SLOT_ORDER) {
            const { named } = ephemeralBandsForSlot(EPHEMERAL_SLOT_ORDER.indexOf(service));

            for (const stage of NAMED_EPHEMERAL_STAGES) {
                const priority = listenerPriorityForStage({ service, stage, baseStage: 'sandbox' });

                expect(priority).toBeGreaterThanOrEqual(named.floor);
                expect(priority).toBeLessThanOrEqual(named.ceiling);
            }
        }
    });

    it('is stable — the same request always yields the same priority', () => {
        const request = { service: 'food', stage: 'dev', baseStage: 'sandbox' } as const;

        expect(listenerPriorityForStage(request)).toBe(listenerPriorityForStage(request));
    });

    it('throws, naming the ceiling, for a PR number the band cannot hold', () => {
        expect(() =>
            listenerPriorityForStage({ service: 'food', stage: `pr-${PER_PR_BAND_WIDTH}`, baseStage: 'sandbox' }),
        ).toThrow(new RegExp(String(PER_PR_BAND_WIDTH)));
    });

    it('admits the very last PR number the band CAN hold — the boundary, not just past it', () => {
        const lastAdmitted = PER_PR_BAND_WIDTH - 1;
        const { perPr } = ephemeralBandsForSlot(EPHEMERAL_SLOT_ORDER.indexOf('food'));

        expect(listenerPriorityForStage({ service: 'food', stage: `pr-${lastAdmitted}`, baseStage: 'sandbox' })).toBe(
            perPr.ceiling,
        );
    });

    it('throws for an UNREGISTERED named stage instead of hashing it into a silent collision', () => {
        // This is the collision decision: named stages are allocated from a registry, so two concurrently
        // deployed named stages CANNOT share a priority. The cost is that a new name must be registered, and
        // the error has to say so.
        expect(() =>
            listenerPriorityForStage({ service: 'food', stage: 'team-feature-x', baseStage: 'sandbox' }),
        ).toThrow(/NAMED_EPHEMERAL_STAGES/);
    });

    it('throws for a malformed pr token rather than aliasing it onto a real PR', () => {
        // `pr-007` and `pr-7` are different stage strings; parsing both to 7 would put two stacks on one
        // priority. `pr-0` is not a PR at all. Both fail loudly instead.
        expect(() => listenerPriorityForStage({ service: 'food', stage: 'pr-007', baseStage: 'sandbox' })).toThrow();
        expect(() => listenerPriorityForStage({ service: 'food', stage: 'pr-0', baseStage: 'sandbox' })).toThrow();
    });

    it('never returns a priority outside the ALB range, across every branch it has', () => {
        const sampled = [
            listenerPriorityForStage({ service: 'identity', stage: 'prod', baseStage: 'prod' }),
            listenerPriorityForStage({ service: 'recipe', stage: 'pr-1', baseStage: 'sandbox' }),
            listenerPriorityForStage({ service: 'recipe', stage: `pr-${PER_PR_BAND_WIDTH - 1}`, baseStage: 'sandbox' }),
            listenerPriorityForStage({ service: 'recipe', stage: 'dev', baseStage: 'sandbox' }),
        ];

        expect(sampled).toHaveLength(4);
        for (const priority of sampled) {
            expect(priority).toBeGreaterThanOrEqual(ALB_MIN_LISTENER_PRIORITY);
            expect(priority).toBeLessThanOrEqual(ALB_MAX_LISTENER_PRIORITY);
        }
    });
});

// ── EXHAUSTIVE DISJOINTNESS — the property the whole scheme exists to guarantee ───────────────────
describe('disjointness, proven exhaustively', () => {
    it('assigns a UNIQUE priority to every registered service × every PR number the band admits', () => {
        const priorities = EPHEMERAL_SLOT_ORDER.flatMap((service) =>
            EVERY_ADMITTED_PR.map((prNumber) =>
                listenerPriorityForStage({ service, stage: `pr-${prNumber}`, baseStage: 'sandbox' }),
            ),
        );

        // Non-vacuity FIRST: a Set-size assertion over an empty list passes and proves nothing.
        expect(priorities).toHaveLength(EPHEMERAL_SLOT_ORDER.length * (PER_PR_BAND_WIDTH - 1));
        expect(priorities.length).toBeGreaterThan(10_000);
        expect(new Set(priorities).size).toBe(priorities.length);
    });

    it('assigns a UNIQUE priority to every registered service × every registered named stage', () => {
        const priorities = EPHEMERAL_SLOT_ORDER.flatMap((service) =>
            NAMED_EPHEMERAL_STAGES.map((stage) => listenerPriorityForStage({ service, stage, baseStage: 'sandbox' })),
        );

        expect(priorities).toHaveLength(EPHEMERAL_SLOT_ORDER.length * NAMED_EPHEMERAL_STAGES.length);
        expect(new Set(priorities).size).toBe(priorities.length);
    });

    it('keeps every band of every RESERVED slot disjoint — the 5th through 8th service included', () => {
        // ⛔ THE CORE PROPERTY. Enumerate every integer every reserved slot could ever be handed, for both
        // ephemeral spans, and assert the Set size equals the count. A duplicated slot, an off-by-one band
        // width, or an overlapping span all collapse the Set and red here.
        const claimed = RESERVED_SLOTS.flatMap((slot) => {
            const { perPr, named } = ephemeralBandsForSlot(slot);
            const perPrValues = Array.from({ length: perPr.ceiling - perPr.floor + 1 }, (_, i) => perPr.floor + i);
            const namedValues = Array.from({ length: named.ceiling - named.floor + 1 }, (_, i) => named.floor + i);

            return [...perPrValues, ...namedValues];
        });

        expect(claimed).toHaveLength(48_000 + 1_000);
        expect(new Set(claimed).size).toBe(claimed.length);

        for (const priority of claimed) {
            expect(priority).toBeGreaterThanOrEqual(NAMED_SPAN_FLOOR);
            expect(priority).toBeLessThanOrEqual(ALB_MAX_LISTENER_PRIORITY);
        }
    });

    it('keeps every base priority disjoint from every ephemeral priority any slot could claim', () => {
        const ephemeral = new Set(
            RESERVED_SLOTS.flatMap((slot) => {
                const { perPr, named } = ephemeralBandsForSlot(slot);

                return [perPr.floor, perPr.ceiling, named.floor, named.ceiling];
            }),
        );
        const basePriorities = EPHEMERAL_SLOT_ORDER.map((service) => BASE_LISTENER_PRIORITY[service]);

        expect(ephemeral.size).toBe(RESERVED_SLOTS.length * 4);
        expect(basePriorities).toHaveLength(EPHEMERAL_SLOT_ORDER.length);

        for (const base of basePriorities) {
            expect(base).toBeLessThan(NAMED_SPAN_FLOOR);
            expect(ephemeral.has(base)).toBe(false);
        }
    });

    it('orders the spans so a value identifies its KIND — base < named < per-PR, strictly', () => {
        const lastSlot = ephemeralBandsForSlot(EPHEMERAL_SERVICE_SLOTS - 1);
        const firstSlot = ephemeralBandsForSlot(0);

        expect(BASE_SPAN_CEILING).toBeLessThan(firstSlot.named.floor);
        expect(lastSlot.named.ceiling).toBeLessThan(firstSlot.perPr.floor);
        expect(lastSlot.perPr.ceiling).toBe(PER_PR_SPAN_CEILING);
    });

    it('never lets one service reuse another service`s per-PR priority — the drift that actually fired', () => {
        // recipe's resolver docstring once carried food's band values (10000+N / 20000+hash). Following it
        // would have put recipe-pr-{N} on food-pr-{N} and failed every per-PR deploy with
        // `Priority '10073' is currently in use`. Asserted across the FULL PR range, not at pr-73.
        const foodPriorities = new Set(
            EVERY_ADMITTED_PR.map((prNumber) =>
                listenerPriorityForStage({ service: 'food', stage: `pr-${prNumber}`, baseStage: 'sandbox' }),
            ),
        );

        expect(foodPriorities.size).toBe(PER_PR_BAND_WIDTH - 1);

        for (const prNumber of EVERY_ADMITTED_PR) {
            const recipePriority = listenerPriorityForStage({
                service: 'recipe',
                stage: `pr-${prNumber}`,
                baseStage: 'sandbox',
            });

            expect(foodPriorities.has(recipePriority)).toBe(false);
        }
    });
});
