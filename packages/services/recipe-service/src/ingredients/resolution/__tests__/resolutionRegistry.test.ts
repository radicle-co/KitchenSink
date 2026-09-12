/**
 * THE REGISTRY GUARD — the cascade's precedence and the reachability of every tier in it, asserted against
 * the REAL registry rather than described in a docstring.
 *
 * ## Why this file exists: a tier died and nothing went red
 *
 * The registry shipped as `[curated, lexical, memo]`, which was R11's literal order. Then KTD-A gave the
 * lexical tier ZERO authority — `decideLexicalTier` resolves on ANY non-empty candidate set, because under
 * withhold semantics a wrong top hit costs a pending line rather than a published bind. R12's second
 * fall-through condition ("confidence below its threshold") therefore stopped existing for the lexical tier,
 * and the only surviving route to the memo tier was "the catalog returned nothing at all". For every phrase
 * the catalog can find, that tier was DEAD — and nothing went red, because the order was a literal nobody
 * could compare against its own reason. ⛔ Nor was it theoretical: `ingredient_resolution_memos` has a live
 * writer in `packages/services/recipe-workers` (`verifyLine.ts` → `rememberAgreement`), so gate-agreed memos
 * were being overruled by catalog guesses in every stage where the gate had run.
 *
 * The lesson is the one `natEgressConsumers.test.ts` and `listenerPriority.ts` already record in this repo:
 * a precedence written down in prose, or a list copied into a test, cannot detect that the thing it
 * describes has changed. So everything below is DERIVED from {@link createResolutionRegistry}'s actual
 * output and from {@link RESOLUTION_TIER_IDS}, and the probe table is keyed by the tier-id union so a tier
 * that ships without a way to reach it is a COMPILE error before it is a test failure.
 *
 * ## The properties, and what each one alone would miss
 *
 *  1. **Probe coverage, both directions.** Every registered tier has a probe and every probe names a
 *     registered tier. Neither side is the authority alone — an unprobed tier is an untested tier, and a
 *     probe for a tier nobody registers is a test asserting something about a chain that does not exist.
 *  2. **Reachability.** With ONLY tier T's evidence present, the cascade answers T. This catches the
 *     coarsest form of the defect — a tier that can never be reached at all because something before it
 *     resolves unconditionally. ⚠️ It is explicitly NOT what catches a precedence inversion: the memo tier
 *     stayed reachable through an empty catalog, so this property was GREEN on the broken chain.
 *  3. **Dominance.** With BOTH tiers' evidence present, the EARLIER-PRECEDENCE tier answers. ⛔ This is the
 *     property the shipped bug violated, and (2) did not.
 *  4. **No precedence inversions.** The registry's order is non-decreasing in precedence rank. Overlaps (3)
 *     on a three-tier chain and is kept anyway, because it fails with a diagnosis ("lexical shadows memo")
 *     rather than with a mismatched food id, and because it is the cheap assertion a fifth tier gets free.
 *  5. **No NEAR-memo answer, anywhere in the chain.** The safety condition the reorder ships under — see the
 *     specs at the bottom of this file and `decideMemoTier`'s docstring.
 *
 * DESIGN PATTERN: **Specification module over the registry** — the probe table is a Strategy per tier-id and
 * the assertions are pure verdicts over the composed evidence world, so the guard exercises the REAL tier
 * adapters (`createCuratedTier` and friends) rather than stand-ins that could agree with a broken chain.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { normalizedIngredientKey } from '@kitchensink/recipe-core/resolution/normalized-key';

import type { CatalogHit } from '../../ingredientSuggestion.js';
import type { FoodCatalogGateway } from '../../foodCatalog.gateway.js';
import type { MappingInForce, MemoHit, ResolutionMappingsDal } from '../resolutionMappings.dal.js';
import { createResolutionRegistry } from '../resolutionRegistry.js';
import {
    RESOLUTION_TIER_IDS,
    evidenceClassOf,
    findPrecedenceInversions,
    precedenceRankOf,
    runResolutionCascade,
    type CascadeObservers,
    type ResolutionQuery,
    type ResolutionTierId,
} from '../resolutionCascade.js';

/** The phrase every probe answers for. Deliberately synonym-free, so no reformulation retry is in play. */
const PHRASE = 'plain flour';
const QUERY: ResolutionQuery = { key: normalizedIngredientKey(PHRASE)!, phrase: PHRASE };
const CONTEXT = { userId: '01JU10GUARD000000000AUTHOR', caller: undefined } as const;

/** A distinct food per tier, so the answer names WHICH evidence was believed and not merely that one was. */
const CURATED_FOOD = '01JU10GUARD000000CURATEDFD';
const MEMO_FOOD = '01JU10GUARD000000000MEMOFD';
const LEXICAL_FOOD = '01JU10GUARD0000000LEXICALF';

/**
 * The evidence each tier's collaborator is holding for {@link PHRASE}. The empty world is every tier's own
 * MISS — not a degradation: the mappings table simply has no row, and the catalog answered `ok` with nothing.
 */
interface EvidenceWorld {
    readonly curated: MappingInForce | undefined;
    readonly memo: MemoHit | undefined;
    readonly catalog: { readonly hits: readonly CatalogHit[]; readonly availability: 'ok' };
}

const EMPTY_WORLD: EvidenceWorld = {
    curated: undefined,
    memo: undefined,
    catalog: { hits: [], availability: 'ok' },
};

/**
 * How a tier is made to ANSWER, or why it is not a tier of this chain.
 *
 * ⛔ The second member is not an escape hatch. `llm` names the verification gate, which `resolutionCascade`'s
 * own docstring establishes is POST-resolution and therefore not a link in this chain at all; recording that
 * here — as data the coverage assertion reads — is what keeps the exclusion a stated decision rather than a
 * tier somebody forgot to probe.
 */
type TierProbe =
    | {
          readonly kind: 'evidence';
          /** The food id this tier answers with once armed, so an assertion can name the believed source. */
          readonly foodId: string;
          /** Place this tier's evidence into the world. Pure. */
          readonly arm: (world: EvidenceWorld) => EvidenceWorld;
      }
    | { readonly kind: 'not-a-chain-tier'; readonly why: string };

/**
 * ⛔ EXHAUSTIVE OVER THE TIER-ID UNION BY TYPE. A new member of {@link RESOLUTION_TIER_IDS} that reaches
 * this map without an entry does not fail a test — it fails `tsc`, which is the earliest point a tier with
 * no route to it can be caught.
 */
const PROBES: Readonly<Record<ResolutionTierId, TierProbe>> = {
    curated: {
        kind: 'evidence',
        foodId: CURATED_FOOD,
        arm: (world) => ({
            ...world,
            curated: { id: 'mapping-row', foodId: CURATED_FOOD, scope: 'global', origin: 'curator' },
        }),
    },
    memo: {
        kind: 'evidence',
        foodId: MEMO_FOOD,
        arm: (world) => ({ ...world, memo: { foodId: MEMO_FOOD, match: 'exact', similarity: 1 } }),
    },
    lexical: {
        kind: 'evidence',
        foodId: LEXICAL_FOOD,
        arm: (world) => ({
            ...world,
            catalog: { availability: 'ok', hits: [{ foodId: LEXICAL_FOOD, name: PHRASE, score: 9 }] },
        }),
    },
    llm: {
        kind: 'not-a-chain-tier',
        why: 'The verification gate runs AFTER a resolution exists; see resolutionCascade.ts and verificationRequests.ts.',
    },
};

/** The ids this guard knows how to reach — derived from the probe table, never listed a second time. */
const PROBED_TIER_IDS: readonly ResolutionTierId[] = RESOLUTION_TIER_IDS.filter((id) => PROBES[id].kind === 'evidence');

/** Arm every named tier's evidence into one world. Pure. */
function worldWith(ids: readonly ResolutionTierId[]): EvidenceWorld {
    return ids.reduce<EvidenceWorld>((world, id) => {
        const probe = PROBES[id];

        return probe.kind === 'evidence' ? probe.arm(world) : world;
    }, EMPTY_WORLD);
}

const OBSERVERS: CascadeObservers = {
    onTierFailure: (tier, error) => {
        throw new Error(`No tier may fail in this guard; '${tier}' did: ${String(error)}`);
    },
};

describe('the resolution registry', () => {
    /** Mutated per case; the doubles read it at call time so ONE registry serves every world. */
    let world: EvidenceWorld = EMPTY_WORLD;

    const mappings = {
        findInForce: async () => world.curated,
        findMemo: async () => world.memo,
    } as unknown as ResolutionMappingsDal;
    const catalog = {
        search: async () => world.catalog,
    } as unknown as FoodCatalogGateway;

    /** THE SUBJECT: the registry production wires, not a re-listing of it. */
    const registry = createResolutionRegistry(mappings, catalog);
    const registeredIds = registry.map((tier) => tier.id);

    beforeEach(() => {
        world = EMPTY_WORLD;
    });

    it('probes exactly the tiers it registers, in both directions', () => {
        // An unprobed registered tier is an untested tier; a probe for an unregistered tier asserts against a
        // chain that does not exist. Set equality is the only form that catches both.
        expect([...registeredIds].sort()).toEqual([...PROBED_TIER_IDS].sort());
    });

    it('registers no tier that has no chain evidence class', () => {
        // The gate is the shape this catches: registering `llm` as a link would give the chain a member whose
        // precedence relative to the others is undefined, which is exactly why it is not one.
        expect(registeredIds.filter((id) => evidenceClassOf(id) === undefined)).toEqual([]);
    });

    it('reaches EVERY registered tier — there is an input for which each one answers', async () => {
        for (const tier of registry) {
            world = worldWith([tier.id]);

            const outcome = await runResolutionCascade(registry, QUERY, CONTEXT, OBSERVERS);
            const probe = PROBES[tier.id];

            expect(outcome.kind).toBe('resolved');
            expect(outcome.kind === 'resolved' ? outcome.tier : undefined).toBe(tier.id);
            expect(outcome.kind === 'resolved' ? outcome.foodId : undefined).toBe(
                probe.kind === 'evidence' ? probe.foodId : undefined,
            );
        }
    });

    it('lets the EARLIER-PRECEDENCE tier win wherever two tiers both hold evidence', async () => {
        const pairs = registry.flatMap((a) => registry.map((b) => [a, b] as const));
        let compared = 0;

        for (const [a, b] of pairs) {
            const evidenceA = evidenceClassOf(a.id);
            const evidenceB = evidenceClassOf(b.id);

            if (
                evidenceA === undefined ||
                evidenceB === undefined ||
                precedenceRankOf(evidenceA) >= precedenceRankOf(evidenceB)
            ) {
                continue;
            }

            compared += 1;
            world = worldWith([a.id, b.id]);

            const outcome = await runResolutionCascade(registry, QUERY, CONTEXT, OBSERVERS);

            expect(
                outcome.kind === 'resolved' ? outcome.tier : 'exhausted',
                `'${b.id}' (${evidenceB}) answered ahead of '${a.id}' (${evidenceA})`,
            ).toBe(a.id);
        }

        // A guard that compared nothing would pass vacuously — the `natEgressConsumers` failure mode.
        expect(compared).toBeGreaterThan(0);
    });

    it('is ordered by precedence — no later-precedence tier stands in front of an earlier one', () => {
        expect(findPrecedenceInversions(registeredIds)).toEqual([]);
    });

    it('⛔ answers from a NEAR memo NOWHERE in the chain — the safety condition this order ships under', async () => {
        // ⚠️ THE COUNTERPART OF THE REORDER, asserted at the CHAIN level rather than only on `decideMemoTier`,
        // because it is a property of the whole chain that must survive a future tier being added.
        //
        // `verifiedBy` is a fact about the STORED key, so a k-NN hit is an identity nobody agreed for the
        // phrase being asked about. Downstream, `pendingStateOf` withholds only `tier === 'lexical'` and
        // `pendingRedrives` covers only `ranked` evidence — so a near memo that RESOLVED would publish
        // immediately, counted and un-redriveable. Before the reorder that needed an empty catalog and was
        // nearly unreachable; after it, it would be the common path. The chain must fall through to a tier
        // whose binds are WITHHELD, which is what this asserts.
        world = { ...worldWith(['lexical']), memo: { foodId: MEMO_FOOD, match: 'near', similarity: 0.72 } };

        const outcome = await runResolutionCascade(registry, QUERY, CONTEXT, OBSERVERS);

        expect(outcome.kind === 'resolved' ? outcome.tier : 'exhausted').toBe('lexical');
        expect(outcome.kind === 'resolved' ? outcome.foodId : undefined).toBe(LEXICAL_FOOD);
    });

    it('⛔ and falls through ENTIRELY when a near memo is the only evidence — never to an unverified bind', async () => {
        // The other half: with no catalog candidate either, exhaustion (which drops the caller to the ordinary
        // food-service path) is the right answer. Publishing the near memo because nothing else spoke is the
        // pre-reorder behaviour and is exactly what must not survive.
        world = { ...EMPTY_WORLD, memo: { foodId: MEMO_FOOD, match: 'near', similarity: 0.72 } };

        const outcome = await runResolutionCascade(registry, QUERY, CONTEXT, OBSERVERS);

        expect(outcome.kind).toBe('exhausted');
    });
});
