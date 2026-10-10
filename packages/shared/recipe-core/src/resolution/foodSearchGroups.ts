/**
 * Which foods an ingredient search offers, and in what order, from plan 002 S5's two split searches: the cook's own
 * foods (`GET /api/v1/foods/authored/search`) and the catalog (`GET /api/v1/foods/catalog/search`). The rule is
 * `docs/design/rowEditorOpenDecisions.md`, "S5 list contract", L1 and L4.3.
 *
 * It lives here because two readers must agree on it: the apps' list model (`@commise/features-recipes`) and the
 * cookbook importer, which resolves a line the way a cook does (`@kitchensink/cookbook-import`).
 *
 * Generic over the result type, so this package does not depend on food's contract.
 *
 * ⛔ Reachable only as `@kitchensink/recipe-core/resolution/food-search-groups`, never from the barrel: `contract-gen`
 * hashes `src/index.ts` (see `searchMinimum.ts`).
 *
 * @pattern Policy module — one pure rule over the two searches' answers
 */

/** A result as either split search returns it. Food's contract allows a null name. */
export interface FoodSearchHit {
    readonly name: string | null;
}

/** A result whose name is known: the only kind a search offers. */
export type NamedFoodHit<H extends FoodSearchHit> = H & { readonly name: string };

/** One list per split search, each in food's order. A search that failed answered nothing. */
export interface FoodSearchGroups<A, C> {
    readonly authored: readonly A[];
    readonly catalog: readonly C[];
}

/** One offered food, tagged with the search that returned it. Whose food it is is never read from a field (L1). */
export type OfferedFood<A extends FoodSearchHit, C extends FoodSearchHit> =
    | { readonly group: 'authored'; readonly hit: NamedFoodHit<A> }
    | { readonly group: 'catalog'; readonly hit: NamedFoodHit<C> };

/**
 * The results one search offers: those with a name that is not blank, in food's order (L1, L4.3). The name is kept as
 * food wrote it. Pure.
 *
 * @param hits - One search's results.
 * @returns The named results.
 */
export function namedFoodHitsOf<H extends FoodSearchHit>(hits: readonly H[]): NamedFoodHit<H>[] {
    return hits.filter((hit): hit is NamedFoodHit<H> => hit.name !== null && hit.name.trim() !== '');
}

/**
 * The two groups in the order a cook sees them: their own foods, then the catalog's (L1). Each item passes through as
 * it is, so a caller that already holds each group's foods keeps them. Pure.
 *
 * @param groups - One list per search.
 * @returns The items of both lists, the cook's own first.
 */
export function inGroupOrder<A, C>(groups: FoodSearchGroups<A, C>): (A | C)[] {
    return [...groups.authored, ...groups.catalog];
}

/**
 * The foods both searches offer, in the order a cook sees them ({@link inGroupOrder}), each group in food's order,
 * with no nameless result ({@link namedFoodHitsOf}). Pure.
 *
 * @param groups - What each search answered.
 * @returns The offered foods, each tagged with its group.
 */
export function offeredFoodsOf<A extends FoodSearchHit, C extends FoodSearchHit>(
    groups: FoodSearchGroups<A, C>,
): OfferedFood<A, C>[] {
    return inGroupOrder<OfferedFood<A, C>, OfferedFood<A, C>>({
        authored: namedFoodHitsOf(groups.authored).map((hit) => ({ group: 'authored', hit })),
        catalog: namedFoodHitsOf(groups.catalog).map((hit) => ({ group: 'catalog', hit })),
    });
}
