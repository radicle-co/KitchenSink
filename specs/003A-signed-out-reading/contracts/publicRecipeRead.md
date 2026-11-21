# Contract: Public Recipe Read

**Feature**: [spec.md](../spec.md) | FR-005 to FR-011 | `021-FR-100` to `021-FR-105`

⚠️ One-way door: native builds in the wild parse this shape. Add forms and fields. Never repurpose one.

## Route

`GET /api/v1/public/{locale}/recipes/{id}` on recipe-service, in the new `src/publicRead/` module. No `/v1` alias (FR-011).

⚠️ One-way door (owner 2026-11-20, 003B C-31): the locale is a PATH segment, because the web forwards no query. Native
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
| The recipe's own author's standing unknown                     | `503`  | `{ "code": "UNAVAILABLE" }`             |
| Past the edge rate limit (production)                          | `429`  | the edge's body, with `Retry-After`     |

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
// Amended 2026-11-15 (owner ruling, ADR-0093): the factsCard and sourceCard forms are withdrawn with facts cards.
type PublicRecipeView = { form: 'full'; recipe: PublicFull };

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

// CreditCook is creditCookSchema (003B FR-062b): a cook, an erased account, or a cook with no name.
type CreditCook =
    | { kind: 'cook'; displayName: string | null; username: string | null } // at least one name non-blank
    | { kind: 'formerMember' }
    | { kind: 'unnamed' };

// PublicCreditChain is 003B's CreditChain (FR-062b), the same schema and the same bytes as the recipe read.
interface PublicCreditChain {
    adaptedBy: CreditCook; // the copy's owner
    source: CreditCook | null; // null is the Commise fallback
    hidden: CreditCook[]; // newest first; the disclosure's {count} is hidden.length
}

// Exactly these keys. The checker has one home, credit.checker.
interface PublicCredit {
    checker: CreditCook | null;
    basedOnUrl: string | null; // the free source site's address (021-FR-014), else null
    adaptedFromId: string | null; // the recipe the label names as the source while openToWeb, else null; null when the standing read fails (fail closed)
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
    creditChain?: PublicCreditChain; // a cook's copy of a public version only (003B FR-062b); absent where the
    // recipe read sends `creditChain: null`
    credit?: PublicCredit; // exactly { checker, basedOnUrl, adaptedFromId }: the checker and free-site domain of a
    // Commise-written version (021-FR-014) and the adapted-from recipe of a copy. 016 and 021 add their own
    // credit keys (family, public domain basis) when they ship, each with its allowlist row
}
```

**Never present**: `ownerId`, `clonedFromId`, `currentVersion`, `status`, `visibility`, `sourceType`, `boundBy`, binding
provenance, `sourceLine` and `sourcePhrase` (the verbatim pasted or imported line is owner-only,
`transcriptionDisclosure.ts`, ADR-0082 §2), `foodId`, `impact`, `viewerRating`, raters, comments, collections and version history. A Commise-written
version never carries the wording of the cook's private copy or a source photo (`021-FR-014`). The
allowlist tests fail when any other key appears. `creditChain` is the one credit-chain key, and its inner keys are exactly those in `PublicCreditChain`. `credit` carries exactly the keys of `PublicCredit`, and the checker has one home, `credit.checker`: a public version's checker is a `formerMember` when `isPseudonymizedAuthorHandle` is true. `credit.adaptedFromId` is the recipe the label names as the source when `openToWeb` of it is true and null otherwise (private, held, deleted, closed or suspended, erased), and the page builds the link with `publicRecipePath`. The standing comes from 003A U4a's `AuthorStandingPort`, through 003B T394. It fails closed: an `unknown` standing for a credited cook or for the source reads as `unnamed` for every such cook who is not erased (checked after erasure) and gives a null `adaptedFromId`, and the read stays `200`; only the recipe's own author's `unknown` standing answers `503` (the table above). The allowlist test is `packages/services/recipe-service/src/publicRead/domain/__tests__/publicRecipeProjection.test.ts` (U4).

**No author for an erased cook.** A recipe whose author standing is `erased` carries no author field and never the
pseudonymous handle `user_{ULID}`, which embeds the user id (spec FR-012, owner ruling Q8). No creator field is
projected for anyone until 012's creator profiles ship, with one exception: names in a copy's credit chain, including the copy's own owner (`adaptedBy`), and the checker line, as `bylineOf` shows them, an @username included (spec Q8, owner 2026-11-20). `creditChain` is the `PublicCreditChain` above, computed by the server. An erased or NULL owner gives `{ kind: 'formerMember' }` (the client reads "a former member"), an owner with no name, or whose account is closed or suspended, gives `{ kind: 'unnamed' }` ("a Commise cook"), never `user_{ULID}`. No account id is on the wire. The only recipe id in the credit is `credit.adaptedFromId`: the id of the recipe the label names as the source, and only while that source is open to the web (`openToWeb`, failing closed), whose own public address already carries it. An entry's stored recipe id never reaches the wire.

**Comments (owner ruling 2026-11-09, spec Q6).** Comments are not built yet. In the release that ships them,
`PublicFull` gains `comments`, picked from the comments schema: each comment's text, its date and its commenter's
display name, never a user id (spec FR-025). Adding the field is growth of the
contract, which this contract allows.

**Clients**: web and native switch exhaustively over `form`.

## Client

`@kitchensink/recipe-service-client` gains `publicRecipes.ts` (a call with no token), `publicRecipeQueries` in
`queries.ts`, and `usePublicRecipe` in `hooks.ts`.
