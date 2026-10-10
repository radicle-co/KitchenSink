/**
 * What a by-name food may be offered, and what it resolves to, when our catalog already holds part of a source's answer
 * (FOOD-SERVICE-6; ADR-0055 point 4: a remote hit for a food the catalog holds is hidden, and the catalog's own entry
 * is the answer).
 *
 * "Held" is the catalog owner reader's answer (`CatalogOwnerReader.standingOfKeys`): an owner, an exact citation, a
 * lineage or a variant, followed to a live catalog entry. It is the same answer remote search hides by, so the two
 * pickers cannot disagree about which items the catalog holds. A hit is hidden by that standing only, never by a root
 * carrying its name: that rule exists because a remote PICK makes a root under the hit's name, and a candidate pick
 * makes none (it fills the by-name food).
 *
 * A source's answer is the merge engine's to judge (FR-MRG-5's survivor count, grouped by `normalizeName`). This module
 * only makes the catalog's entries take part in that count:
 *
 * - each live entry holding hits is one survivor, and a hit sharing a held hit's name joins that survivor;
 * - one survivor resolves: by a forward when it is a holder, by the merge when it is not;
 * - several survivors stay `UNRESOLVED`, over the candidates that can be offered;
 * - no survivor that can be offered and several holders is `NOT_FOUND`, because offering a holder is a candidate
 *   shape the wire does not carry, and choosing one would choose between foods.
 *
 * @pattern Specification — pure rules over a source's hits, the catalog's standing for their keys, and the merge result
 * @module
 */
import type { KeyStanding } from '../catalogOwnerReader.service.js';
import type { FoodRef } from '../foods.schema.js';
import { normalizeName } from '../foodName.js';
import type { MergeCandidate, MergeResult } from '../merge/mergeEngine.js';
import type { FoodSourceId, SourceCandidate } from '../../sources/foodSourceAdapter.js';

/** A source's hits, split by the catalog's standing. */
export interface HitPartition {
    /** The hits the catalog does not hold, in the source's order, once per key: the ones to fetch and offer. */
    readonly offered: readonly SourceCandidate[];
    /** The live catalog entries holding the hidden hits, once each, in the source's order. */
    readonly holders: readonly FoodRef[];
}

/** What a fan-out's answer does to the by-name food. */
export type FanOutDecision =
    /** The catalog held nothing: the merge engine's outcome stands. */
    | { readonly kind: 'merge' }
    /** The catalog's entry is the only survivor: the food is forwarded to it. */
    | { readonly kind: 'forward'; readonly to: FoodRef }
    /** Several survivors, a holder among them: a cook picks from the candidates that can be offered. */
    | { readonly kind: 'unresolved'; readonly candidateSet: readonly MergeCandidate[] }
    /** Nothing can be offered, and several entries hold the answer. */
    | { readonly kind: 'notFound' };

/** What a cook's pick does. */
export type PickDecision =
    { readonly kind: 'merge' } | { readonly kind: 'forward'; readonly to: FoodRef } | { readonly kind: 'refuse' };

/** A source item, by its key. */
export interface SourceItemRef {
    readonly source: FoodSourceId;
    readonly externalKey: string;
}

/**
 * Whether one source's key is held by a live entry other than the food itself. Pure.
 *
 * @param standing - The catalog's standing for that source's keys.
 * @param key - The key.
 * @param selfId - The by-name food, which is no holder of a key it owns.
 * @returns The holder, or `undefined`.
 */
function holderOf(standing: KeyStanding | undefined, key: string, selfId: string): FoodRef | undefined {
    const owner = standing?.owners.get(key);

    return owner === undefined || owner.rootId === selfId ? undefined : { kind: owner.kind, id: owner.id };
}

/**
 * The live entries holding some of these items, once each in item order, ignoring the food itself. Pure.
 *
 * @param items - The items, in order.
 * @param standings - The catalog's standing for each source's keys: a key is unique within its source only.
 * @param selfId - The food being resolved.
 * @returns The holders.
 */
export function holdersOfItems(
    items: readonly SourceItemRef[],
    standings: ReadonlyMap<FoodSourceId, KeyStanding>,
    selfId: string,
): FoodRef[] {
    const holders = new Map<string, FoodRef>();

    for (const item of items) {
        const holder = holderOf(standings.get(item.source), item.externalKey, selfId);

        if (holder !== undefined) {
            holders.set(`${holder.kind}:${holder.id}`, holder);
        }
    }

    return [...holders.values()];
}

/**
 * Split a source's hits into the ones to offer and the catalog entries holding the rest. Pure.
 *
 * @param hits - The source's hits, in its order.
 * @param standing - The catalog's standing for their keys.
 * @param selfId - The by-name food.
 * @returns The offered hits and the holders.
 */
export function partitionHeldHits(
    hits: readonly SourceCandidate[],
    standing: KeyStanding,
    selfId: string,
): HitPartition {
    const isHeld = (key: string): boolean => holderOf(standing, key, selfId) !== undefined;
    const heldNames = new Set(hits.filter((hit) => isHeld(hit.externalKey)).map((hit) => normalizeName(hit.name)));
    const seen = new Set<string>();
    const offered: SourceCandidate[] = [];
    const holders = new Map<string, FoodRef>();

    for (const hit of hits) {
        if (seen.has(hit.externalKey)) {
            continue;
        }

        seen.add(hit.externalKey);

        const holder = holderOf(standing, hit.externalKey, selfId);

        if (holder !== undefined) {
            holders.set(`${holder.kind}:${holder.id}`, holder);
        } else if (!standing.retired.has(hit.externalKey) && !heldNames.has(normalizeName(hit.name))) {
            offered.push(hit);
        }
    }

    return { offered, holders: [...holders.values()] };
}

/**
 * What a fan-out's answer does, given the merge of the offered candidates and the holders of the hidden hits. Pure.
 *
 * @param offered - The fetched candidates that can be offered.
 * @param result - The merge engine's result over them.
 * @param holders - The live entries holding the hidden hits.
 * @returns The decision.
 */
export function fanOutDecisionOf(
    offered: readonly MergeCandidate[],
    result: MergeResult,
    holders: readonly FoodRef[],
): FanOutDecision {
    const [holder, ...otherHolders] = holders;

    if (holder === undefined) {
        return { kind: 'merge' };
    }

    if (result.outcome !== 'NOT_FOUND') {
        return { kind: 'unresolved', candidateSet: result.outcome === 'UNRESOLVED' ? result.candidateSet : offered };
    }

    return otherHolders.length === 0 ? { kind: 'forward', to: holder } : { kind: 'notFound' };
}

/**
 * What a cook's pick does when the catalog may hold some of the picked items. Pure.
 *
 * A pick naming one holder's items resolves to that holder; the cook chose the catalog's food, and any unheld item
 * picked beside it would only blend a second food's numbers into it. Picks naming two holders, or an item the catalog
 * retired with no forward, are refused rather than decided.
 *
 * @param picks - The picked items.
 * @param standing - The catalog's standing for their keys.
 * @param selfId - The food being resolved.
 * @returns The decision.
 */
export function pickDecisionOf(
    picks: readonly SourceItemRef[],
    standings: ReadonlyMap<FoodSourceId, KeyStanding>,
    selfId: string,
): PickDecision {
    if (picks.some((pick) => standings.get(pick.source)?.retired.has(pick.externalKey) === true)) {
        return { kind: 'refuse' };
    }

    const [holder, ...otherHolders] = holdersOfItems(picks, standings, selfId);

    if (holder === undefined) {
        return { kind: 'merge' };
    }

    return otherHolders.length === 0 ? { kind: 'forward', to: holder } : { kind: 'refuse' };
}
