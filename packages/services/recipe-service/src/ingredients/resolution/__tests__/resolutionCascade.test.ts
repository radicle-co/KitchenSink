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
    evidenceClassOf,
    findPrecedenceInversions,
    precedenceRankOf,
    runResolutionCascade,
    type CascadeObservers,
    type ResolutionQuery,
    type ResolutionTier,
    type ResolutionTierId,
} from '../resolutionCascade.js';

const KEY = normalizedIngredientKey('plain flour')!;
const QUERY: ResolutionQuery = { key: KEY, phrase: 'plain flour' };
const CONTEXT = { userId: '01JU10CASCADE0000000AUTHOR', caller: undefined } as const;

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

/**
 * THE PRECEDENCE LADDER — the consultation ORDER's ruling, as a truth table over the pure functions carrying
 * it.
 *
 * The order the cascade runs in used to be knowledge that lived in one place only: the literal array in the
 * module wiring. Nothing could compare that array against the REASON it was in that order, which is how the
 * lexical tier came to sit in front of the memo tier once KTD-A removed its threshold. These functions are
 * that reason made checkable; `resolutionRegistry.test.ts` fires them at the real registry.
 *
 * ⚠️ Every assertion here is about WHO IS ASKED FIRST. None of it is about whether the answer may be
 * published — that is `pendingStateOf`'s question, and keeping the two apart is why these classes are named
 * after the evidence SOURCE rather than after a trust level.
 */
describe('the consultation-precedence ladder', () => {
    it('asks a curated mapping before a remembered verification, and both before a catalog ranking', () => {
        // The whole ruling in one assertion: a curator's word (R19) is asked before a row recording that the
        // gate agreed, which is asked before the catalog search KTD-A gives ZERO authority and withholds on.
        expect(precedenceRankOf('curated-mapping')).toBeLessThan(precedenceRankOf('remembered-verification'));
        expect(precedenceRankOf('remembered-verification')).toBeLessThan(precedenceRankOf('catalog-ranking'));
    });

    it('gives every CHAIN tier an evidence class, and the verification gate none', () => {
        expect(evidenceClassOf('curated')).toBe('curated-mapping');
        expect(evidenceClassOf('memo')).toBe('remembered-verification');
        expect(evidenceClassOf('lexical')).toBe('catalog-ranking');
        // ⛔ Not an omission. `llm` names the gate, which runs AFTER a resolution exists, so it has no
        // precedence relative to the links of this chain — and `undefined` is what makes registering it as
        // one a detectable defect rather than a silent reordering.
        expect(evidenceClassOf('llm')).toBeUndefined();
    });

    it('finds no inversion in a correctly ordered chain, however short', () => {
        expect(findPrecedenceInversions([])).toEqual([]);
        expect(findPrecedenceInversions(['lexical'])).toEqual([]);
        expect(findPrecedenceInversions(['curated', 'memo', 'lexical'])).toEqual([]);
        expect(findPrecedenceInversions(['curated', 'lexical'])).toEqual([]);
    });

    it('names the SHADOWING tier and the one it shadows', () => {
        // The shipped defect, as the guard sees it.
        expect(findPrecedenceInversions(['curated', 'lexical', 'memo'])).toEqual([
            { shadowing: 'lexical', shadowed: 'memo' },
        ]);
    });

    it('reports NON-ADJACENT inversions too, so a three-deep reordering cannot hide behind its neighbours', () => {
        // Adjacent-pair checking alone would find `lexical` before `memo` here and miss `lexical` before
        // `curated` — the worse of the two, since it is a machine guess outranking a human ruling.
        expect(findPrecedenceInversions(['lexical', 'memo', 'curated'])).toEqual([
            { shadowing: 'lexical', shadowed: 'memo' },
            { shadowing: 'lexical', shadowed: 'curated' },
            { shadowing: 'memo', shadowed: 'curated' },
        ]);
    });

    it('treats EQUAL precedence as no inversion — order between peers is a cost decision, not a precedence one', () => {
        expect(findPrecedenceInversions(['memo', 'memo'])).toEqual([]);
    });

    it('ignores an id with no chain evidence class rather than inventing a rank for it', () => {
        // A registered `llm` is caught by the registry guard's own assertion, not by silently sorting it.
        expect(findPrecedenceInversions(['lexical', 'llm'])).toEqual([]);
    });
});
