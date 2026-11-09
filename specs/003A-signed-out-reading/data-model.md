# Data Model: Signed-out Reading of Public Recipes

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-11-09

003A adds **no table and no migration**. Every entity here is a value computed at read time, a wire shape, or a token.
The rule reads facts that already exist (visibility, status, deletion, source type, food bindings) and readings that
other features will produce. Nothing is stored about a signed-out reader.

## Reading

One input to the open-to-web rule. A discriminated union, so a new kind is a compile error in every switch.

| Field    | Type                                  | Notes                                            |
| -------- | ------------------------------------- | ------------------------------------------------ |
| `status` | `'open'` \| `'closed'` \| `'unknown'` | `unknown` reads as closed (`020-FR-059`, FR-002) |
| `source` | the producer's name                   | For logs and tests only. Never on the wire       |

The rule's inputs, each a required field of `OpenToWebInput`:

| Input            | 021 rule                   | Producer in 003A                                  | Value until the producer ships |
| ---------------- | -------------------------- | ------------------------------------------------- | ------------------------------ |
| `visibility`     | rule 1                     | the recipe row                                    | real                           |
| `status`         | rule 2                     | the recipe row                                    | real                           |
| `deleted`        | rule 3                     | the recipe row                                    | real                           |
| `hold`           | rule 4 (`020-FR-057`)      | 020's hold Specification                          | `unknown`                      |
| `rightsLabel`    | rule 5 (`016-FR-015c`)     | 016's label Policy                                | `unknown`                      |
| `licence`        | rule 6 (`021-FR-040`)      | 016's licence acceptance                          | `unknown`                      |
| `authorStanding` | rule 7                     | identity, through the standing read (research R4) | real, and `unknown` on failure |
| `restriction`    | rule 8                     | 016's notice and action decisions                 | fixed `none` (see below)       |
| `sourceCap`      | `021-FR-014e` (cards only) | 021's cap and aggregator list                     | `unknown`                      |

The rule is a composite of two halves: `contentOpen` over the row and the content readings, then `authorActive` over
the author standing. `contentOpen` runs first, so a closed recipe never causes a call to identity or food. While the
feature ships dark, `contentOpen` always closes.

**The one fixed reading.** `restriction` is fixed at `none`, because recipe-service has no takedown or restriction
table, so no recipe can be restricted today. That is the only case FR-002 allows: the closed state cannot happen yet.
016's notice and action work replaces it with a real producer. Every other unbuilt reading is `unknown`.

## Public form

What the rule decides. A discriminated union on `form`.

| Form          | When                                                                                 | Fields                                          |
| ------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `full`        | every input open, and the rights label is one of `021-FR-002` rule 5's labels        | the full projection                             |
| `factsCard`   | the rights label is a copied page or a book, every other input open, the cap open    | exactly `021-FR-014a`'s fields                  |
| `sourceCard`  | a facts card whose source opted out, is past its cap, or is excluded (`021-FR-014e`) | title, site name, link only                     |
| not available | anything else                                                                        | one fixed `404` body, not a member of the union |

State changes: only a change of an input changes the form. Each such change is an exit event (`021-FR-007`) and shows within
the 5-minute cache life (FR-013).

## Public recipe view (wire)

`PublicRecipeView` is owned by recipe-service (`publicRead/publicRecipes.schema.ts`) and copied to
`@kitchensink/schema-recipe` (GR-015, ADR-0014). Each member lists its own keys, and a type test holds each shared key
equal to the service's `RecipeResponse`. The exact shape is in [contracts/publicRecipeRead.md](contracts/publicRecipeRead.md).

Never on the wire: `ownerId`, `clonedFromId`, `currentVersion`, `boundBy`, binding provenance, impact counts, the
viewer's rating, raters, comments, collections, private foods.

Validation:

- `id` is a UUID. Anything else is not available, never a `400`.
- `slug` is derived from the title by one pure function, and is not stored.
- A facts card's lines carry `{ quantity, unit, foodName }` only, plus `unreadLineCount`. No `displayText`, `note` or
  `preparation` (`021-FR-014b`).
- A full recipe line whose food did not answer has `foodName: null` and keeps its `displayText`. The count of such
  lines is `missingNutritionCount` (FR-008).
- Photos are thumbnails only (FR-026).
- A `full` member needs a `licence`, which no producer can give until 016 ships. So `full` cannot be built yet.

## Author standing

| Value       | Meaning                                                               |
| ----------- | --------------------------------------------------------------------- |
| `active`    | the owner can be shown                                                |
| `suspended` | identity's `users.status = 'suspended'` (ADR-0081)                    |
| `closed`    | identity's `users.status = 'tombstoned'`: the account is closed       |
| `erased`    | the account is erased. Closed until the owner rules on donations (Q8) |
| `unknown`   | no identity row, a timeout or an error. Reads as closed               |

Only `active` opens. It is read on each origin miss and is not stored by recipe-service.

## Public recipe address

A Value Object with one pure parser, `parsePublicRecipePath`.

| Part   | Rule                                                                   |
| ------ | ---------------------------------------------------------------------- |
| prefix | `/recipe/`, with no locale                                             |
| `id`   | a UUID                                                                 |
| `slug` | optional. Lower-case words joined by single dashes, derived from title |

A path that does not parse is not a public recipe address. The query string is ignored by the page and the cache, and
read only by measurement (the share mark's presence).

## Public-reader token

A short-lived EdDSA JWT that recipe-service signs, with one audience for food and one for identity. The exact claims
are in [contracts/publicReaderToken.md](contracts/publicReaderToken.md). It names no user and no recipe.

## Pending action

A value from a closed set, `saveCopy` or `rate`, carried as `?then=` in the sign-in return path `/{locale}/recipes/{id}`. Parsed like `?done=`. A value
outside the set is ignored. Not stored on the device.
