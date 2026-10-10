/**
 * Which catalog entry answers a nutrition-batch id (curated catalog plan U8 S6, R18; ADR-0020). An id names a root or
 * a variant (one id namespace), and a retired one answers as the entry its forward ends at — under the REQUESTED id,
 * so the edge caches the target's numbers at the URL the caller asked for. A catalog root or variant the seed retired
 * with no successor answers its OWN numbers (curated U9 P0, R29), through the resolver's own end predicate.
 *
 * ⛔ Catalog only, enforced here and not by the reader: the batch is cached on its URL alone (ADR-0020), so an
 * authored root — requested directly, as a variant's root, or at a forward's end — answers nothing, exactly as an
 * unknown id does. No caller enters this module.
 *
 * DESIGN PATTERN: Specification — "is this id a catalog entry that answers, and which one" — over the resolver's one
 * forward rule (`refTargetOf`) and its one end predicate (`answeringEntryOf`).
 *
 * @module
 */
import type { FoodStatus } from '../dao/food.dao.js';
import { answeringEntryOf, refTargetOf, type RefFacts } from './foodRefResolution.js';

/** The catalog entry whose numbers answer an id. */
export type NutritionTarget =
    | { readonly kind: 'root'; readonly rootId: string; readonly status: FoodStatus }
    | { readonly kind: 'variant'; readonly variantId: string; readonly rootId: string; readonly status: FoodStatus };

/**
 * The entry answering one requested id. Pure.
 *
 * @param id - The requested id: a root's or a variant's.
 * @param facts - What the owner reader read for the id, as both a root and a variant ref.
 * @returns The target, or `undefined` for an unknown, authored, mid-erasure or unresolvable id.
 */
export function nutritionTargetOf(id: string, facts: RefFacts): NutritionTarget | undefined {
    const kind = facts.roots.has(id) ? 'root' : facts.variants.has(id) ? 'variant' : undefined;

    if (kind === undefined) {
        return undefined;
    }

    const target = refTargetOf({ kind, id }, facts);
    const entry = target === undefined ? undefined : answeringEntryOf(target, facts);

    if (entry === undefined || entry.root.userId !== null) {
        return undefined;
    }

    const { root, variant } = entry;

    return variant === undefined
        ? { kind: 'root', rootId: root.id, status: root.status }
        : { kind: 'variant', variantId: variant.id, rootId: root.id, status: root.status };
}
