/**
 * Which of a remote source's hits a cook is shown, and which are search gaps (ADR-0055 point 4, R66; review finding 7).
 *
 * - A hit for a food the catalog holds (the owner reader's answer: an owner, an exact citation, a lineage, a variant)
 *   is hidden: the catalog's own entry is the answer, and adopting the hit would make a second root for one food.
 * - So is a hit whose root name a live catalog root already carries, when that root answers the name
 *   (`namedRootPolicy.ts`): a pick of it answers that root. A placeholder carrying the name leaves the hit shown,
 *   because a pick completes the placeholder with it.
 * - When the root answering a hidden hit is not in this answer's catalog results, the hit names wording our catalog
 *   lacks, and is a gap. When the root is there, the hit is a duplicate of a result the cook already sees, and records
 *   nothing. When the catalog read failed, presence is unknown, so nothing is recorded rather than every held hit.
 * - A hit for an item the catalog retired with no forward is hidden and records nothing.
 * - Every other hit is shown, in the source's order, once per key and once per root name, because a pick makes a root
 *   under that name and two hits sharing it would answer one root. No variant is ever made from one (R64).
 *
 * @pattern Specification — one pure rule over a source's hits, the catalog's standing for their keys and names, and
 *   the results
 * @module
 */
import type { RemoteSearchItem, RemoteSearchSource } from '@kitchensink/schema-remote-search';

import type { KeyStanding } from '../catalogOwnerReader.service.js';
import type { NamedRoot } from '../dao/remoteAdoption.dao.js';
import { remoteRootKeyOf } from '../remote/remoteRootName.js';
import { answersItsName } from './namedRootPolicy.js';

/** One search gap: wording a cook used for a food our catalog holds under other words. No user (ADR-0027). */
export interface SearchGap {
    /** The canonical term the cook searched for. */
    readonly query: string;
    readonly source: RemoteSearchSource;
    /** The source's key for the item it answered with. */
    readonly externalKey: string;
    /** The root that holds the item. */
    readonly foodId: string;
    /** The variant that holds the item, or `null` when the root does. */
    readonly foodVariantId: string | null;
    /** The source's name for the item. */
    readonly remoteName: string;
}

/** What the rule reads. */
export interface RemoteHitTriageInput {
    /** The canonical term. */
    readonly query: string;
    readonly source: RemoteSearchSource;
    /** The source's hits, in its order. */
    readonly items: readonly RemoteSearchItem[];
    /** The catalog's standing for the hits' keys. */
    readonly standing: KeyStanding;
    /** The live catalog roots carrying the hits' root names, by name key (`remoteRootKeyOf`). */
    readonly namedRoots: ReadonlyMap<string, NamedRoot>;
    /** The roots this answer's catalog results show, or `undefined` when the catalog read failed. */
    readonly catalogRootIds: ReadonlySet<string> | undefined;
}

/** What the cook is shown, and the gaps to record. */
export interface RemoteHitTriage {
    readonly shown: readonly RemoteSearchItem[];
    readonly gaps: readonly SearchGap[];
}

/** What the catalog says about one hit. */
type HitStanding =
    | { readonly kind: 'absent' }
    | { readonly kind: 'retired' }
    | { readonly kind: 'answered'; readonly rootId: string; readonly variantId: string | null };

/**
 * What the catalog says about one hit: the entry holding its key, else the item retired, else the live root that
 * carries its root name and answers it. Pure.
 *
 * @param item - The hit.
 * @param standing - The catalog's standing for the hits' keys.
 * @param namedRoots - The live catalog roots carrying the hits' root names, by name key.
 * @returns The hit's standing.
 */
function hitStandingOf(
    item: RemoteSearchItem,
    standing: KeyStanding,
    namedRoots: ReadonlyMap<string, NamedRoot>,
): HitStanding {
    const owner = standing.owners.get(item.externalKey);

    if (owner !== undefined) {
        return { kind: 'answered', rootId: owner.rootId, variantId: owner.kind === 'variant' ? owner.id : null };
    }

    if (standing.retired.has(item.externalKey)) {
        return { kind: 'retired' };
    }

    const named = namedRoots.get(remoteRootKeyOf(item.name));

    return named !== undefined && answersItsName(named.status)
        ? { kind: 'answered', rootId: named.id, variantId: null }
        : { kind: 'absent' };
}

/**
 * Triage a source's hits. Pure.
 *
 * @param input - The term, the source, its hits, their standing, the roots named by them and the catalog results' roots.
 * @returns The hits to show, one per key and root name, and the gaps to record, one per key, in the source's order.
 */
export function triageRemoteHits(input: RemoteHitTriageInput): RemoteHitTriage {
    const { standing, namedRoots, catalogRootIds } = input;
    const seen = new Set<string>();
    const shownRoots = new Set<string>();
    const shown: RemoteSearchItem[] = [];
    const gaps: SearchGap[] = [];

    for (const item of input.items) {
        if (seen.has(item.externalKey)) {
            continue;
        }

        seen.add(item.externalKey);

        const hit = hitStandingOf(item, standing, namedRoots);

        if (hit.kind === 'absent') {
            const rootKey = remoteRootKeyOf(item.name);

            if (!shownRoots.has(rootKey)) {
                shownRoots.add(rootKey);
                shown.push(item);
            }

            continue;
        }

        if (hit.kind === 'answered' && catalogRootIds !== undefined && !catalogRootIds.has(hit.rootId)) {
            gaps.push({
                query: input.query,
                source: input.source,
                externalKey: item.externalKey,
                foodId: hit.rootId,
                foodVariantId: hit.variantId,
                remoteName: item.name,
            });
        }
    }

    return { shown, gaps };
}
