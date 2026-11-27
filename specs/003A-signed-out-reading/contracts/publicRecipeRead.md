# Contract: Public Recipe Read

**Feature**: [spec.md](../spec.md) | FR-005 to FR-011 | `021-FR-100` to `021-FR-105`

⚠️ One-way door: native builds in the wild parse this shape. Add forms and fields. Never repurpose one.

## Route

`GET /api/v1/public/{locale}/recipes/{id}` on recipe-service, in the new `src/publicRead/` module. No `/v1` alias (FR-011).

⚠️ One-way door (owner 2026-11-20): the locale is a PATH segment, because the web forwards no query. Native
builds in the wild call this path, so it is never renamed. The locale must be in the shipped set; an unshipped or
malformed locale answers the one `404` body. The route is pinned by 003A U4's integration test (plan, test table).

- It is excluded from the Clerk `AuthMiddleware`, and only this path and method are excluded.
- It reads no `Authorization` header, cookie or session. It takes no `@CallerBearerToken()` and no
  `@CurrentPrincipal()`. The `publicReadNoCredential` guard fails the build on any such read (FR-006).
- It is `@SkipThrottle()` at the origin. The per-address limit lives at the edge (research R6).
- It captures no `recipe_viewed` event with an actor, and reads no impact signals (FR-010).
- CORS is unchanged. No browser calls it (research R7).

## Responses

Every answer is `Cache-Control: no-store`. The CDN caches the web page (research R5), so no layer caches the API.

| Case                                                           | Status | Body                                    |
| -------------------------------------------------------------- | ------ | --------------------------------------- |
| Open                                                           | `200`  | `PublicRecipeView`                      |
| Not available: every closed case, a malformed id, a missing id | `404`  | `{ "code": "NOT_AVAILABLE" }`, one body |
| An id retired by an erasure's name scrub (`016-FR-037`)        | `410`  | `{ "code": "GONE" }`, one body          |
| Past the edge rate limit (production)                          | `429`  | the edge's body, with `Retry-After`     |

The `404` body is the same bytes for every closed case. It never says why. A retired id is not a closed recipe: the recipe lives on under a new id, which the `410` never names.

**Order inside the service.** The `{id}` is resolved first (data-model, Public id). Only a current public id is accepted, and a row id answers `404`. A retired id answers `410` and no recipe is read. Then the row is read and the rule (`contentOpen`) runs. When it closes, the `404` goes out with no call to food. While the feature ships dark, every read stops there. Only an open row reaches the food call. The public read never answers `503`: a food failure gives `200` with `foodName: null` and `missingNutritionCount` (FR-008).

## `PublicRecipeView`

Authored as zod in `recipe-service/src/publicRead/publicRecipes.schema.ts` with `z.strictObject` on the server, and
copied to `@kitchensink/schema-recipe` by `contract:generate` (ADR-0014). The client parses it leniently and reads an
unknown `form` as not available.

`RecipeResponse` is a TypeScript interface, not a zod schema (`dto/recipeResponse.dto.ts`). So "pick from the service
schema" is enforced by a type test: for every key the public schema shares with `RecipeResponse`, the types are
exactly equal (`Exact<Pick<PublicX, K>, Pick<RecipeResponse, K>>`), except `id`: on the public view it is the public id, and on `RecipeResponse` the row id. A new field on `RecipeResponse` never reaches the
public shape, because the public schema lists its own keys.

```ts
// Reading aid. The zod schema in the service is the authority.
// Amended 2026-11-15 (owner ruling, ADR-0093): the factsCard and sourceCard forms are withdrawn with facts cards.
type PublicRecipeView = { form: 'full'; recipe: PublicFull };

type PublicAuthor = { kind: 'named'; displayName: string } | { kind: 'former' };

interface PublicFacts {
    id: string; // UUID, the public id (recipe_public_ids), never recipes.id
    slug: string; // derived from the title, never stored
    title: string;
    author?: PublicAuthor; // absent unless 021-FR-024 allows a name or the cook is erased
    servings: number | null;
    prepTimeMinutes: number | null;
    cookTimeMinutes: number | null;
    totalTimeMinutes: number | null;
    stepCount: number;
    averageRating?: number; // absent with no rating (001-FR-013a)
    ratingCount: number;
    nutrition: PublicNutritionState; // picked from the recipe nutrition state, partial flag included
    photos: { url: string }[]; // thumbnails only (FR-026); no row id or owner id in the address (data-model, Photo addresses)
}

interface PublicFull extends PublicFacts {
    description?: string;
    cuisine?: string;
    difficulty?: RecipeDifficulty;
    tags: string[];
    ingredients: {
        position: number;
        displayText: string; // the cook's own words, always present
        quantity: Quantity | null;
        unit: string | null;
        foodName: string | null; // null when food did not answer
        groupLabel?: string;
    }[];
    steps: { position: number; instruction: string; timerSeconds?: number }[];
    missingNutritionCount: number;
    licence: PublicLicence; // REQUIRED. No 016 value exists yet, so `full` cannot be built until 016 ships
    credit?: PublicCredit; // adapted, family, public domain basis, a clone source while it is open, or a
    // Commise-written version's disclosure and free-site domain (021-FR-014)
}
```

**Never present**: `ownerId`, `clonedFromId`, `currentVersion`, `status`, `visibility`, `sourceType`, `boundBy`, binding
provenance, `sourceLine` and `sourcePhrase` (the verbatim pasted or imported line is owner-only,
`transcriptionDisclosure.ts`, ADR-0082 §2), `foodId`, `impact`, `viewerRating`, raters, comments, collections and version history. A Commise-written
version never carries the wording of the cook's private copy or a source photo (`021-FR-014`). The
allowlist tests fail when any other key appears.

**The author.** `PublicAuthor` is a closed union: `{ kind: 'named', displayName }` only where `021-FR-024` allows a name (the cook has a creator profile that is active, or suspended, terminated or closed under the 2026-11-21 amendment), and `{ kind: 'former' }` for an erased cook. `author` is absent in every other case, including every page before 012 ships, and the projection reads neither `recipes.author_handle` nor `recipes.author_username` before 012. A recipe that carries the erasure marker (data-model, Erased owner) gives `former`: the client reads "a former member", with no name and no link. The marker carries no user id (`016-FR-076`), and the wire never carries it (spec FR-012, owner ruling Q8). No other creator field is projected for anyone until 012's creator profiles ship.

**Comments (owner ruling 2026-11-09, spec Q6).** Comments are not built yet. In the release that ships them,
`PublicFull` gains `comments`, picked from the comments schema: each comment's text, its date and its commenter's
display name, never a user id (spec FR-025). Adding the field is growth of the
contract, which this contract allows.

**Clients**: web and native switch exhaustively over `form`.

## Client

`@kitchensink/recipe-service-client` gains `publicRecipes.ts` (a call with no token), `publicRecipeQueries` in
`queries.ts`, and `usePublicRecipe` in `hooks.ts`.
