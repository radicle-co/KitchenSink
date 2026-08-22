/**
 * Unit tests for the resolution cascade — the Chain of Responsibility no unit previously owned (plan U10 /
 * R11, R12, R22).
 *
 * U5, U6, U10 and U11 each build a TIER; until this module, nothing ran them in order, decided when a tier
 * had answered, or terminated the chain. So the properties asserted here are the chain's own contract, and
 * nothing about any tier's internals:
 *
 *  1. **Order is honoured and the FIRST resolution wins** (R11). A mutant that ran the tiers concurrently, or
 *     took the last answer, would still "resolve" every query — and would silently outrank a curated mapping
 *     with a machine guess, which is the precedence R19 exists to establish.
 *  2. **A resolution TERMINATES the chain** (R12). Later tiers are not consulted at all — not merely ignored.
 *     This is the difference between an LLM call that never happens and one whose result is discarded, and it
 *     is the whole of AE6's and AE8's "without an LLM call".
 *  3. **A tier that THROWS does not take the cascade down, and is not silently equated with a miss.** A
 *     database blip on the mappings table must not make every ingredient unresolvable; equally, "we could not
 *     look" must not be reported as "we looked and found nothing", because the caller writes a terminal
 *     status on one and retries the other.
 *  4. **Exhaustion is reported with what was consulted**, so a caller can tell an unattended import's
 *     "recorded unresolved" (R22) from a transient degradation.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';

import {
    runResolutionCascade,
    type CascadeObservers,
    type ResolutionQuery,
    type ResolutionTier,
    type ResolutionTierId,
} from '../resolutionCascade.js';

const KEY = normalizedIngredientKey('plain flour')!;
const QUERY: ResolutionQuery = { key: KEY, phrase: 'plain flour' };
const CONTEXT = { authorId: '01JU10CASCADE0000000AUTHOR' } as const;

/** A tier that always resolves to `foodId`, recording that it was consulted. */
function resolving(id: ResolutionTierId, foodId: string, consulted: ResolutionTierId[]): ResolutionTier {
    return {
        id,
        resolve: async () => {
            consulted.push(id);

            return { kind: 'resolved', tier: id, foodId, evidence: `${id} hit` };
        },
    };
}

/** A tier that always passes, recording that it was consulted. */
function passing(id: ResolutionTierId, consulted: ResolutionTierId[]): ResolutionTier {
    return {
        id,
        resolve: async () => {
            consulted.push(id);

            return { kind: 'pass', tier: id, reason: `${id} miss` };
        },
    };
}

/** A tier whose I/O fails. */
function failing(id: ResolutionTierId, consulted: ResolutionTierId[]): ResolutionTier {
    return {
        id,
        resolve: async () => {
            consulted.push(id);
            throw new Error(`${id} exploded`);
        },
    };
}

/** The failure sink every run must be given — the cascade never swallows a tier failure silently. */
function sink(): CascadeObservers & { onTierFailure: Mock<(tier: ResolutionTierId, error: unknown) => void> } {
    return { onTierFailure: vi.fn<(tier: ResolutionTierId, error: unknown) => void>() };
}

describe('runResolutionCascade — order, and the first answer wins (R11)', () => {
    it('consults tiers in the order given and returns the FIRST resolution', async () => {
        const consulted: ResolutionTierId[] = [];
        const outcome = await runResolutionCascade(
            [
                passing('curated', consulted),
                resolving('lexical', 'FOOD-LEXICAL', consulted),
                resolving('memo', 'FOOD-MEMO', consulted),
            ],
            QUERY,
            CONTEXT,
            sink(),
        );

        expect(outcome.kind).toBe('resolved');
        expect(outcome.kind === 'resolved' && outcome.foodId).toBe('FOOD-LEXICAL');
        expect(outcome.kind === 'resolved' && outcome.tier).toBe('lexical');
        expect(consulted).toEqual(['curated', 'lexical']);
    });

    it('lets a CURATED mapping outrank every later tier (R19)', async () => {
        const consulted: ResolutionTierId[] = [];
        const outcome = await runResolutionCascade(
            [resolving('curated', 'FOOD-CURATED', consulted), resolving('memo', 'FOOD-MEMO', consulted)],
            QUERY,
            CONTEXT,
            sink(),
        );

        expect(outcome.kind === 'resolved' && outcome.foodId).toBe('FOOD-CURATED');
    });
});

describe('runResolutionCascade — a resolution TERMINATES the chain (R12)', () => {
    it('does NOT call a later tier at all once one has answered', async () => {
        const later = { id: 'llm' as const, resolve: vi.fn() };
        const consulted: ResolutionTierId[] = [];

        await runResolutionCascade([resolving('curated', 'FOOD-A', consulted), later], QUERY, CONTEXT, sink());

        // Not merely "its answer was ignored" — it was never invoked. This is the whole of AE6's and AE8's
        // "resolves … without an LLM call", and the reason the assertion is on the SPY and not the outcome.
        expect(later.resolve).not.toHaveBeenCalled();
    });

    it('reports only the tiers it actually consulted', async () => {
        const consulted: ResolutionTierId[] = [];
        const outcome = await runResolutionCascade(
            [passing('curated', consulted), resolving('memo', 'FOOD-A', consulted), passing('llm', consulted)],
            QUERY,
            CONTEXT,
            sink(),
        );

        expect(outcome.consulted).toEqual(['curated', 'memo']);
    });
});

describe('runResolutionCascade — exhaustion (R22)', () => {
    it('reports exhaustion when every tier passes, naming all of them', async () => {
        const consulted: ResolutionTierId[] = [];
        const outcome = await runResolutionCascade(
            [passing('curated', consulted), passing('memo', consulted)],
            QUERY,
            CONTEXT,
            sink(),
        );

        expect(outcome.kind).toBe('exhausted');
        expect(outcome.consulted).toEqual(['curated', 'memo']);
        expect(outcome.unavailable).toEqual([]);
    });

    it('reports exhaustion for an EMPTY chain rather than throwing', async () => {
        // The registry is configuration, and a mis-wired module must degrade to "the cascade knew nothing"
        // rather than 500-ing every ingredient add.
        const outcome = await runResolutionCascade([], QUERY, CONTEXT, sink());

        expect(outcome.kind).toBe('exhausted');
        expect(outcome.consulted).toEqual([]);
    });
});

describe('runResolutionCascade — a tier that FAILS is contained, and is not a miss', () => {
    it('continues to the next tier and still resolves', async () => {
        const consulted: ResolutionTierId[] = [];
        const outcome = await runResolutionCascade(
            [failing('curated', consulted), resolving('memo', 'FOOD-A', consulted)],
            QUERY,
            CONTEXT,
            sink(),
        );

        expect(outcome.kind === 'resolved' && outcome.foodId).toBe('FOOD-A');
        expect(consulted).toEqual(['curated', 'memo']);
    });

    it('names the failed tier separately from the ones that merely missed', async () => {
        const consulted: ResolutionTierId[] = [];
        const outcome = await runResolutionCascade(
            [failing('curated', consulted), passing('memo', consulted)],
            QUERY,
            CONTEXT,
            sink(),
        );

        expect(outcome.kind).toBe('exhausted');
        // ⛔ THE DISTINCTION THAT MATTERS: `unavailable` is non-empty, so this is "we could not look", not
        // "we looked and found nothing". A caller that wrote a terminal NOT_FOUND on this would be recording
        // a database blip as a permanent fact about the ingredient.
        expect(outcome.unavailable).toEqual(['curated']);
        expect(outcome.consulted).toEqual(['curated', 'memo']);
    });

    it('reports every failure to the sink, so a degraded tier is never silent', async () => {
        const consulted: ResolutionTierId[] = [];
        const failures = sink();

        await runResolutionCascade(
            [failing('curated', consulted), failing('memo', consulted)],
            QUERY,
            CONTEXT,
            failures,
        );

        expect(failures.onTierFailure).toHaveBeenCalledTimes(2);
        expect(failures.onTierFailure).toHaveBeenCalledWith('curated', expect.any(Error));
        expect(failures.onTierFailure).toHaveBeenCalledWith('memo', expect.any(Error));
    });

    it('does not let a failing SINK take the cascade down with it', async () => {
        const consulted: ResolutionTierId[] = [];
        const outcome = await runResolutionCascade(
            [failing('curated', consulted), resolving('memo', 'FOOD-A', consulted)],
            QUERY,
            CONTEXT,
            {
                onTierFailure: () => {
                    throw new Error('the logger is down too');
                },
            },
        );

        // Observability is not allowed to become an availability dependency: a broken sink degrades the
        // signal, never the resolution.
        expect(outcome.kind === 'resolved' && outcome.foodId).toBe('FOOD-A');
    });
});
