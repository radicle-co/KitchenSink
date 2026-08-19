/**
 * Resolve ONE parsed ingredient name the way a person using the app would — and in no other way.
 *
 * DESIGN PATTERN: **Port + orchestration**. The port ({@link IngredientResolutionPort}) is the narrow set
 * of recipe-service calls the app's own picker makes; this function sequences them. `RecipeApiClient`
 * satisfies the port structurally, and a fake satisfies it in tests.
 *
 * ## ⛔ WHY THIS FILE CONTAINS NO MATCHING LOGIC, AND MUST NEVER GAIN ANY
 *
 * The question this import exists to answer is *"how well does the SYSTEM match real recipe language
 * against the USDA catalog?"* — which is only answerable if the system does the matching. An importer that
 * searched the food catalog itself, scored the hits and submitted a pre-chosen `foodId` would be measuring
 * its own matching code, and would flatter the result twice over: once by out-thinking the product, and
 * again by quietly dropping whatever it failed to match.
 *
 * So, concretely, and each of these is pinned by a test:
 *
 *  - **The food service is never called.** The port has no method for it; recipe-service performs the food
 *    lookup on the caller's behalf, forwarding the caller's own bearer, exactly as it does for the app.
 *  - **The FIRST suggestion wins.** The blending, deduplication and scoring are the service's. Re-ranking
 *    here would substitute this file's opinion for the thing under measurement.
 *  - **The name is sent verbatim.** No stemming, no de-pluralising, no dropping of "sifted" or "chopped" to
 *    find a friendlier match. If the product would not do it for a user, this must not do it either.
 *  - **No line is ever discarded for failing to resolve.** Every name ends as SOMETHING — a catalog row, a
 *    food-backed pending row, or a freeform row — so the denominator of the resolution rate stays honest.
 *
 * ## The sequence mirrors `useIngredientResolver`
 *
 * The app's shared picker hook (`@commise/features-recipes`) resolves a line in exactly these ways: pick a
 * blended suggestion (`local` directly, `catalog` via `POST /ingredients/by-food`); or, for a typed name the
 * list did not contain, "Find nutrition for X" (`POST /ingredients/by-name`, asynchronous); or the explicit
 * freeform fallback (`POST /ingredients`). This function walks the same ladder in the same order.
 *
 * @sideEffect Every branch performs network I/O through the port.
 */
import type { Ingredient, IngredientSuggestions } from './RecipeApiClient.js';

/** The recipe-service calls the app's ingredient picker makes. Deliberately has NO food-service method. */
export interface IngredientResolutionPort {
    /** `GET /api/v1/ingredients/suggest` — the product's own blended lookup. */
    suggestIngredients: (query: string, limit?: number) => Promise<IngredientSuggestions>;
    /** `POST /api/v1/ingredients/by-food` — admit a food-catalog suggestion the user picked. */
    addIngredientByFood: (foodId: string) => Promise<Ingredient>;
    /** `POST /api/v1/ingredients/by-name` — "Find nutrition for X" for a name not in the list. */
    addIngredientByName: (name: string) => Promise<Ingredient>;
    /** `POST /api/v1/ingredients` — the explicit freeform fallback. */
    createFreeformIngredient: (name: string) => Promise<Ingredient>;
}

/** How a name came to have a catalog row. Each value is a distinct fact about the system's lookup. */
export type IngredientResolutionKind = 'local_suggestion' | 'catalog_suggestion' | 'added_by_name' | 'freeform';

/** The outcome for one ingredient name, with everything the report needs to explain it. */
export interface IngredientResolution {
    /** Which rung of the ladder produced the row. */
    readonly kind: IngredientResolutionKind;
    /** The name as the recipe's prose gave it — never rewritten. */
    readonly query: string;
    /** The catalog row the recipe line will reference. */
    readonly ingredient: Ingredient;
    /**
     * Whether the food catalog was reachable for this lookup.
     *
     * ⚠️ Reported because `'unavailable'` and "no match" are DIFFERENT facts that would otherwise be
     * counted as one. A resolution rate measured during a food-service outage describes the outage, not
     * the catalog's coverage.
     */
    readonly catalogAvailability: IngredientSuggestions['catalogAvailability'];
    /** Why add-by-name was not used, when the freeform fallback was reached. */
    readonly fallbackReason?: string;
}

/**
 * Resolve one ingredient name through the product's own path.
 *
 * @param port - The recipe-service calls the picker makes.
 * @param name - The ingredient name exactly as the recipe's prose gave it.
 * @returns How the name resolved, and to which catalog row.
 * @throws When even the freeform fallback fails — at which point the recipe genuinely cannot be created.
 * @sideEffect Network I/O; may create a catalog row.
 */
export async function resolveIngredientLikeAUser(
    port: IngredientResolutionPort,
    name: string,
): Promise<IngredientResolution> {
    const suggestions = await port.suggestIngredients(name);
    const { catalogAvailability } = suggestions;
    const top = suggestions.suggestions[0];

    if (top !== undefined) {
        if (top.provenance === 'local') {
            return { kind: 'local_suggestion', query: name, ingredient: top.ingredient, catalogAvailability };
        }

        return {
            kind: 'catalog_suggestion',
            query: name,
            ingredient: await port.addIngredientByFood(top.foodId),
            catalogAvailability,
        };
    }

    // Nothing in the list. The app's PRIMARY action here is "Find nutrition for {query}" — an asynchronous
    // add-by-name that comes back PENDING/UNRESOLVED. A non-terminal status is NOT a failure; it is the
    // pipeline starting work, and the caller polls for it.
    try {
        return {
            kind: 'added_by_name',
            query: name,
            ingredient: await port.addIngredientByName(name),
            catalogAvailability,
        };
    } catch (error) {
        // The picker's own last rung: "We couldn't add that ingredient. Create a custom one below instead."
        // Reaching it must never lose the line — an unresolved ingredient is data, a missing one is a lie
        // about what the recipe contains.
        return {
            kind: 'freeform',
            query: name,
            ingredient: await port.createFreeformIngredient(name),
            catalogAvailability,
            fallbackReason: error instanceof Error ? error.message : String(error),
        };
    }
}
