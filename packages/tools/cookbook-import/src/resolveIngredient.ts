/**
 * Resolve ONE parsed ingredient name the way a cook using the app would — and in no other way.
 *
 * DESIGN PATTERN: **Port + orchestration**. Two ports, one per service, each the narrow set of calls the app's own
 * ingredient entry makes: {@link FoodSearchPort} (food's two split searches, plan 002 S5) and
 * {@link RecipeBindingPort} (recipe's binding doors). This function sequences them. `FoodServiceClient` and
 * `RecipeApiClient` satisfy them structurally, and fakes satisfy them in tests.
 *
 * ## ⛔ WHY THIS FILE CONTAINS NO MATCHING LOGIC, AND MUST NEVER GAIN ANY
 *
 * The question this import exists to answer is *"how well does the SYSTEM match real recipe language
 * against the USDA catalog?"* — which is only answerable if the system does the matching. An importer that
 * scored the hits itself and submitted a pre-chosen `foodId` would be measuring its own matching code, and
 * would flatter the result twice over: once by out-thinking the product, and again by quietly dropping
 * whatever it failed to match.
 *
 * So, concretely, and each of these is pinned by a test:
 *
 *  - **It searches only what the list searches.** The food port has the two split searches and nothing else — no
 *    live search (a cook's deliberate, quota-spending press) and no legacy search.
 *  - **The FIRST offered food wins.** Which foods are offered, and in what order, is the shared rule
 *    (`@kitchensink/recipe-core/resolution/food-search-groups`) the app's list uses. Re-ranking here would
 *    substitute this file's opinion for the thing under measurement.
 *  - **The name is sent verbatim.** No stemming, no de-pluralising, no dropping of "sifted" or "chopped" to
 *    find a friendlier match. If the product would not do it for a cook, this must not do it either.
 *  - **No line is ever discarded for failing to resolve.** Every name ends as SOMETHING — a food-backed binding,
 *    a pending failure record, or a declared name — so the denominator of the resolution rate stays honest.
 *
 * ## The sequence mirrors the app's ingredient entry
 *
 * A cook picks an offered food (bound by id: `POST /ingredients/by-food`, or `by-food-variant` for a catalog
 * result that names a variant); or, under "Not listed?", asks for nutrition by name (`POST /ingredients/by-name`,
 * asynchronous) or uses the name as written (`POST /ingredients`). This function walks the same ladder in the same
 * order. Each search fails on its own, as the list's do (S5 list contract L3), and is reported as unavailable rather
 * than as a miss.
 *
 * @sideEffect Every branch performs network I/O through the ports.
 */
import { isFoodServiceClientError, type FoodServiceClient } from '@kitchensink/food-service-client';
import {
    offeredFoodsOf,
    type FoodSearchHit,
    type OfferedFood,
} from '@kitchensink/recipe-core/resolution/food-search-groups';
import { describeRankingName, describeRankingQuery } from '@kitchensink/recipe-core/resolution/ranking-terms';

import type { RecipeApiClient } from './RecipeApiClient.js';

/** Food's two split searches, as the app's list calls them. Deliberately nothing else of food's. */
export type FoodSearchPort = Pick<FoodServiceClient, 'searchAuthored' | 'searchCatalog'>;

/** Recipe's binding doors, as the app's ingredient entry uses them. */
export type RecipeBindingPort = Pick<
    RecipeApiClient,
    'addIngredientByFood' | 'addIngredientByFoodVariant' | 'addIngredientByName' | 'createFreeformIngredient'
>;

/** The two services a lookup crosses. */
export interface IngredientResolutionPorts {
    readonly food: FoodSearchPort;
    readonly recipe: RecipeBindingPort;
}

/** The binding a recipe line takes, as recipe's binding doors answer it. */
type Binding = Awaited<ReturnType<RecipeBindingPort['addIngredientByFood']>>;

/** How a name came to have a binding. Each value is a distinct fact about the system's lookup. */
export type IngredientResolutionKind = 'authored_suggestion' | 'catalog_suggestion' | 'added_by_name' | 'freeform';

/**
 * Whether one search answered. ⚠️ `'unavailable'` and "found nothing" are DIFFERENT facts that would otherwise be
 * counted as one: a resolution rate measured during a food-service outage describes the outage, not the catalog.
 */
export type SearchAvailability = 'ok' | 'unavailable';

/** The outcome for one ingredient name, with everything the report needs to explain it. */
export interface IngredientResolution {
    /** Which rung of the ladder produced the binding. */
    readonly kind: IngredientResolutionKind;
    /** The name as the recipe's prose gave it — never rewritten. */
    readonly query: string;
    /** The binding the recipe line will reference. */
    readonly ingredient: Binding;
    /** Whether the catalog search answered for this lookup. */
    readonly catalogAvailability: SearchAvailability;
    /** Whether the search of the caller's own foods answered for this lookup. */
    readonly authoredAvailability: SearchAvailability;
    /** Why add-by-name was not used, when the freeform fallback was reached. */
    readonly fallbackReason?: string;
    /**
     * What LED the list, when one did (owner ruling 2026-08-31, U15 report "Owner rulings" §2): the report is the
     * operator-side instrument for the list's ranking quality. OBSERVATION ONLY: nothing here changes which food is
     * taken, or the measurement stops describing the product (this file's own prime directive).
     */
    readonly lead?: SuggestionLead;
}

/** The first offered food's group, and whether it was a weak token-only match for the query. */
export interface SuggestionLead {
    readonly group: OfferedFood<FoodSearchHit, FoodSearchHit>['group'];
    /**
     * `true` when a lead from the caller's OWN foods has a head noun that is not among the query's tokens — the
     * capture shape U15 measured, which the cook's own foods can now produce because they lead whenever they match
     * (S5 list contract L1, "What groups cost"). Judged by the same `describeRankingName`/`describeRankingQuery`
     * vocabulary the services rank with.
     */
    readonly weakTokenLead: boolean;
}

/** One search's answer: its results, or none because it failed. */
interface SearchOutcome<H> {
    readonly results: readonly H[];
    readonly availability: SearchAvailability;
}

/**
 * Run one search, turning a food-service failure into an unavailable search with no results (S5 list contract L3).
 * Anything else is a defect, and is rethrown rather than reported as an outage.
 *
 * @param search - The search.
 * @returns Its results and whether it answered.
 * @throws What the search threw, when it is not a food-service failure.
 * @sideEffect Performs the search.
 */
async function settle<H>(search: Promise<{ readonly results: readonly H[] }>): Promise<SearchOutcome<H>> {
    try {
        return { results: (await search).results, availability: 'ok' };
    } catch (error) {
        if (isFoodServiceClientError(error)) {
            return { results: [], availability: 'unavailable' };
        }

        throw error;
    }
}

/**
 * Observe what led the list. Pure.
 *
 * @param query - The name as searched.
 * @param top - The first offered food.
 * @returns The lead observation.
 */
function leadOf(query: string, top: OfferedFood<FoodSearchHit, FoodSearchHit>): SuggestionLead {
    if (top.group === 'catalog') {
        return { group: 'catalog', weakTokenLead: false };
    }

    const head = describeRankingName(top.hit.name).head;

    return {
        group: 'authored',
        weakTokenLead: head === undefined || !describeRankingQuery(query).tokens.includes(head),
    };
}

/**
 * Resolve one ingredient name through the product's own path.
 *
 * @param ports - The searches and binding doors the app's ingredient entry uses.
 * @param name - The ingredient name exactly as the recipe's prose gave it.
 * @returns How the name resolved, and to which binding.
 * @throws When a binding door fails other than add-by-name, or when even the freeform fallback fails — at which
 *   point the recipe genuinely cannot be created.
 * @sideEffect Network I/O; may create a binding.
 */
export async function resolveIngredientLikeAUser(
    ports: IngredientResolutionPorts,
    name: string,
): Promise<IngredientResolution> {
    const [authored, catalog] = await Promise.all([
        settle(ports.food.searchAuthored(name)),
        settle(ports.food.searchCatalog(name)),
    ]);
    const availability = { authoredAvailability: authored.availability, catalogAvailability: catalog.availability };
    const top = offeredFoodsOf({ authored: authored.results, catalog: catalog.results })[0];

    if (top !== undefined) {
        const lead = leadOf(name, top);

        if (top.group === 'authored') {
            return {
                kind: 'authored_suggestion',
                query: name,
                ingredient: await ports.recipe.addIngredientByFood(top.hit.id),
                ...availability,
                lead,
            };
        }

        // A catalog result that names a variant binds that variant (rowEditorOpenDecisions.md, S5 list contract L4.1).
        return {
            kind: 'catalog_suggestion',
            query: name,
            ingredient:
                top.hit.variant === undefined
                    ? await ports.recipe.addIngredientByFood(top.hit.id)
                    : await ports.recipe.addIngredientByFoodVariant(top.hit.variant.id),
            ...availability,
            lead,
        };
    }

    // Nothing in the list. The app's PRIMARY action here is "Find nutrition for {query}" — an asynchronous
    // add-by-name that comes back PENDING/UNRESOLVED. A non-terminal status is NOT a failure; it is the
    // pipeline starting work, and the caller polls for it.
    try {
        return {
            kind: 'added_by_name',
            query: name,
            ingredient: await ports.recipe.addIngredientByName(name),
            ...availability,
        };
    } catch (error) {
        // The entry's last rung: use the name as written. Reaching it must never lose the line — an unresolved
        // ingredient is data, a missing one is a lie about what the recipe contains.
        return {
            kind: 'freeform',
            query: name,
            ingredient: await ports.recipe.createFreeformIngredient(name),
            ...availability,
            fallbackReason: error instanceof Error ? error.message : String(error),
        };
    }
}
