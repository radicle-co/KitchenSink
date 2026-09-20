/**
 * A TYPED `ParseLineDeps` for the integration tier — the house `make*` + `Partial<T>` factory.
 *
 * ⛔ IT SERVES `parseLeg`, whose two suites build the same wide deps twice. The other two suites that build
 * one — `parseLineClaim` and `crfAbsenceRetry` — do NOT take it, and that is deliberate: each needs a
 * differently-shaped `gated` double (one throws on `resolve`, one counts `converse`, this one is the happy
 * path), which a shallow `Partial<ParseLineDeps>` override cannot express. Three literals that differ for
 * three different reasons are DAMP, not duplication, and with the casts gone all three are compiler-checked,
 * so there is no drift-blindness left to consolidate away.
 *
 * ⛔ WHAT ALL THREE HAD IN COMMON WAS THE CAST, and that is what is gone. Each of them cast the wide ports
 * (`gated` and its `ledger` and `bedrock`, and `pool`), so the doubles would have kept compiling after the
 * port they stand for changed shape — blindness in the PASS direction, in the one tier that exists to
 * observe a real boundary. (`localParsePath` builds no deps by design: it drives the SHIPPED
 * `createLocalParseLineDeps` wiring, and a hand-assembled deps there would leave that wiring unexercised.
 * `parseJobExpiry` needs none at all.)
 *
 * ⛔ AND THE CASTS WERE ALREADY CONCEALING A DEFECT, which is the argument for the rule rather than an
 * illustration of it: three of those literals omitted `GatedLlmDeps.deployRegion` — a REQUIRED member —
 * entirely, and `as never` accepted all three. `bandDrain.test.ts` states the same rule for its own pool
 * double; this is that rule applied where the deps object is wide.
 *
 * ⚠️ What remains cast in these files is a DIFFERENT class and is deliberately left: branded string types
 * (`LineDigest`, `ParsedFacts`, normalized correction keys) at the suites' own data-construction sites. No
 * port's shape hides behind those, so none can go stale against a changed interface.
 *
 * ⚠️ Every default here is a STAND-IN, not a stub of convenience: the ledger always reserves and never
 * settles a real charge, and the Bedrock double answers an empty array. A suite that cares about either
 * overrides it by name, which is what makes the override visible at the call site instead of buried in a
 * thirty-line literal.
 *
 * ⛔ The DATABASE is deliberately NOT defaulted — `pool` is required. It is the one dependency these suites
 * are actually testing against, and a factory that quietly supplied a fake one would let a caller believe
 * it had a real database when it did not.
 */
import { vi } from 'vitest';

import type { ParseLineDeps } from '../../../../src/handlers/parseLine.js';
import { realSleep } from '../../../../src/parsing/parseLease.js';
import type { ParseQueryable } from '../../../../src/parsing/parsePorts.js';

/** What a caller must supply: the real database handle, and the digest the suite is keyed on. */
export interface ParseLineDepsSeed {
    readonly pool: ParseQueryable;
    readonly digest: ParseLineDeps['digest'];
    readonly crf: ParseLineDeps['crf'];
}

/**
 * Build a `ParseLineDeps` whose every port is typed.
 *
 * @param seed - The database handle, digest and CRF engine the suite owns.
 * @param overrides - Anything the suite needs to differ, by name.
 * @returns A fully-typed deps object. Pure apart from the `vi.fn()` doubles it creates.
 */
export function makeParseLineDeps(seed: ParseLineDepsSeed, overrides: Partial<ParseLineDeps> = {}): ParseLineDeps {
    const gated: ParseLineDeps['gated'] = {
        stage: 'sandbox',
        deployRegion: 'us-east-1',
        settings: {
            resolve: async () => ({ ceilingMicros: 100_000_000, modelId: 'amazon.nova-micro-v1:0' }),
        },
        ledger: {
            reserve: async () => ({ kind: 'reserved' as const, reservedMicros: 1 }),
            settle: async () => undefined,
        },
        bedrock: {
            converse: async () => ({
                kind: 'answered' as const,
                text: '[]',
                stopReason: 'end_turn',
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            }),
        },
        emit: vi.fn(),
        now: () => new Date(),
    };

    return {
        stage: 'sandbox',
        emit: vi.fn(),
        gated,
        crf: seed.crf,
        pool: seed.pool,
        digest: seed.digest,
        parseModelId: 'amazon.nova-micro-v1:0',
        claimLeaseSeconds: 150,
        deliveryAllowance: 20,
        // ⛔ THE DEPLOYED TIMER ITSELF, deliberately — the same `realSleep` both wirings pass. This tier's
        // concurrency cases turn on the loser actually waiting for the winner to land, so a stub would
        // exercise a different system than the one deployed. The UNIT suite stubs it, where the point is to
        // observe the decision rather than the clock.
        sleep: realSleep,
        ...overrides,
    };
}

/**
 * A timer that does not wait, for a suite that asserts LANDING behaviour rather than concurrency.
 *
 * ⚠️ A concurrency case added to such a suite would silently not wait — it must take the deployed timer
 * (`realSleep`, which {@link makeParseLineDeps} already passes) instead of this.
 */
export const instantSleep = async (): Promise<void> => {};
