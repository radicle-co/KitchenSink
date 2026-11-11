# Contract: Public Recipe Read

**Feature**: [spec.md](../spec.md) | FR-005 to FR-011 | `021-FR-100` to `021-FR-105`

⚠️ One-way door: native builds in the wild parse this shape. Add forms and fields. Never repurpose one.

## Route

`GET /api/v1/public/recipes/{id}` on recipe-service, in the new `src/publicRead/` module. No `/v1` alias (FR-011).

- It is excluded from the Clerk `AuthMiddleware`, and only this path and method are excluded.
- It reads no `Authorization` header, cookie or session. It takes no `@CallerBearerToken()` and no
  `@CurrentPrincipal()`. The `publicReadNoCredential` guard fails the build on any such read (FR-006).
- It is `@SkipThrottle()` at the origin. The per-address limit lives at the edge (research R6).
- It captures no `recipe_viewed` event with an actor, and reads no impact signals (FR-010).
- CORS is unchanged. No browser calls it (research R7).

## Responses

Every answer is `Cache-Control: no-store`. The web page owns caching (research R5), so no layer caches the API.

| Case                                                             | Status | Body                                    |
| ---------------------------------------------------------------- | ------ | --------------------------------------- |
| Open                                                             | `200`  | `PublicRecipeView`                      |
| Not available: every closed case, a malformed id, a missing id   | `404`  | `{ "code": "NOT_AVAILABLE" }`, one body |
| Author standing unknown, or a facts card whose food names failed | `503`  | `{ "code": "UNAVAILABLE" }`             |
| Past the edge rate limit (production)                            | `429`  | the edge's body, with `Retry-After`     |

The `404` body is the same bytes for every closed case. It never says why.

**Order inside the service.** The row is read and the content half of the rule (`contentOpen`) runs first. When it
closes, the `404` goes out with no call to food or identity. While the feature ships dark, every read stops there.
Only an open row reaches the identity and food calls.

## `PublicRecipeView`

Authored as zod in `recipe-service/src/publicRead/publicRecipes.schema.ts` with `z.strictObject` on the server, and
copied to `@kitchensink/schema-recipe` by `contract:generate` (ADR-0014). The client parses it leniently and reads an
unknown `form` as not available.

`RecipeResponse` is a TypeScript interface, not a zod schema (`dto/recipeResponse.dto.ts`). So "pick from the service
schema" is enforced by a type test: for every key the public schema shares with `RecipeResponse`, the types are
exactly equal (`Exact<Pick<PublicX, K>, Pick<RecipeResponse, K>>`). A new field on `RecipeResponse` never reaches the
public shape, because the public schema lists its own keys.

```ts
// Reading aid. The zod schema in the service is the authority.
type PublicRecipeView =
    | { form: 'full'; recipe: PublicFull }
    | { form: 'factsCard'; card: PublicFactsCard }
    | { form: 'sourceCard'; card: PublicSourceCard };

interface PublicFacts {
    id: string; // UUID
    slug: string; // derived from the title, never stored
    title: string;
    servings: number | null;
    prepTimeMinutes: number | null;
    cookTimeMinutes: number | null;
    totalTimeMinutes: number | null;
    stepCount: number;
    averageRating?: number; // absent with no rating (001-FR-013a)
    ratingCount: number;
    nutrition: PublicNutritionState; // picked from the recipe nutrition state, partial flag included
    photos: { url: string }[]; // thumbnails only (FR-026)
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
    credit?: PublicCredit; // adapted, family, public domain basis, or a clone source while it is open
}

interface PublicFactsCard extends PublicFacts {
    ingredients: { position: number; quantity: Quantity | null; unit: string | null; foodName: string }[];
    unreadLineCount: number; // 2026-11-04 ruling
    ownerNotes?: string; // the owner's own words only (021-FR-014a)
    source:
        | { kind: 'web'; siteName: string; url: string }
        | { kind: 'book'; title: string; author?: string; publisher?: string }
        | { kind: 'paidSite'; siteName: string };
}

interface PublicSourceCard {
    id: string;
    slug: string;
    title: string;
    source: { siteName: string; url: string };
}
```

**Never present**: `ownerId`, `clonedFromId`, `currentVersion`, `status`, `visibility`, `sourceType`, `boundBy`, binding
provenance, `sourceLine` and `sourcePhrase` (the verbatim pasted or imported line is owner-only,
`transcriptionDisclosure.ts`, ADR-0082 §2), `foodId`, `impact`, `viewerRating`, raters, comments, collections and version history. A facts card never
carries `displayText`, `note`, `preparation`, `description`, step text or a source photo (`021-FR-014b`). The
allowlist tests fail when any other key appears.

**No author for an erased cook.** A recipe whose author standing is `erased` carries no author field and never the
pseudonymous handle `user_{ULID}`, which embeds the user id (spec FR-012, owner ruling Q8). No creator field is
projected for anyone until 012's creator profiles ship.

**Comments (owner ruling 2026-11-09, spec Q6).** Comments are not built yet. In the release that ships them,
`PublicFull` gains `comments`, picked from the comments schema: each comment's text, its date and its commenter's
display name, never a user id (spec FR-025). A facts card never carries comments. Adding the field is growth of the
contract, which this contract allows.

**Clients**: web and native switch exhaustively over `form`.

## Client

`@kitchensink/recipe-service-client` gains `publicRecipes.ts` (a call with no token), `publicRecipeQueries` in
`queries.ts`, and `usePublicRecipe` in `hooks.ts`.
