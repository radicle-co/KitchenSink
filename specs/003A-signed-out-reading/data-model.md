# Data Model: Signed-out Reading of Public Recipes

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-11-09

003A adds schema in recipe-service's database: the public-id tables `recipe_public_ids` and `recipe_retired_public_ids` with their trigger (Public id, U4, owner ruling 2026-11-21), and the media keys `owner_media_keys` and `recipes.media_key` (Photo addresses, U15). Each unit owns its migration. The erasure marker column comes from the closure plan's U3b migration. The other entities here are values computed at read time, wire shapes or tokens.
The rule reads facts that already exist (visibility, status, deletion, source type, food bindings) and readings that
other features will produce. Nothing is stored about a signed-out reader.

## Reading

One input to the open-to-web rule. A discriminated union, so a new kind is a compile error in every switch.

| Field    | Type                                  | Notes                                            |
| -------- | ------------------------------------- | ------------------------------------------------ |
| `status` | `'open'` \| `'closed'` \| `'unknown'` | `unknown` reads as closed (`020-FR-059`, FR-002) |
| `source` | the producer's name                   | For logs and tests only. Never on the wire       |

The rule's inputs, each a required field of `OpenToWebInput`:

| Input         | 021 rule               | Producer in 003A                                                   | Value until the producer ships |
| ------------- | ---------------------- | ------------------------------------------------------------------ | ------------------------------ |
| `visibility`  | rule 1                 | the recipe row                                                     | real                           |
| `status`      | rule 2                 | the recipe row                                                     | real                           |
| `deleted`     | rule 3                 | the recipe row                                                     | real                           |
| `hold`        | rule 4 (`020-FR-057`)  | 020's hold Specification                                           | `unknown`                      |
| `rightsLabel` | rule 5 (`016-FR-015c`) | 016's label Policy                                                 | `unknown`                      |
| `licence`     | rule 6 (`021-FR-040`)  | 016's licence acceptance                                           | `unknown`                      |
| `restriction` | rule 8                 | 016's notice and action decisions and its recipe hide record (§16) | fixed `none` (see below)       |

The rule is `contentOpen` over the row and the content readings. Rule 7 (author standing) is withdrawn (owner ruling 2026-11-21, spec FR-012), so the rule reads no account. A closed recipe never causes a call to food. While the feature ships dark, `contentOpen` always closes.

**The one fixed reading.** `restriction` is fixed at `none` until 016's notice and action decisions or its recipe hide record (`016` data-model §16) ships, because recipe-service has no takedown or
restriction table today. `016` L121-01 makes it real, and that task blocks 016's takedown, the closure plan's U4b, and turning this feature on. The real reading is also read by `isRecipeViewableBy` and its SQL twins for non-owners (`016` data-model §16). That is the only case FR-002 allows while the closed state cannot happen yet.
Rule 8 reads both producers, and the reading becomes real when either of them ships. Every other unbuilt reading is `unknown`.

## Public form

What the rule decides. A discriminated union on `form`.

| Form          | When                                                                          | Fields                                          |
| ------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| `full`        | every input open, and the rights label is one of `021-FR-002` rule 5's labels | the full projection                             |
| not available | anything else                                                                 | one fixed `404` body, not a member of the union |

State changes: only a change of an input changes the form. Each such change is an exit event (`021-FR-007`) and shows within
the 5-minute cache life (FR-013).

## Public recipe view (wire)

`PublicRecipeView` is owned by recipe-service (`publicRead/publicRecipes.schema.ts`) and copied to
`@kitchensink/schema-recipe` (GR-015, ADR-0014). Each member lists its own keys, and a type test holds each shared key
equal to the service's `RecipeResponse`. The exact shape is in [contracts/publicRecipeRead.md](contracts/publicRecipeRead.md).

Never on the wire: the recipe's row id (`recipes.id`), `ownerId`, `clonedFromId`, `currentVersion`, `boundBy`, binding provenance, impact counts, the
viewer's rating, raters, comments, collections, private foods, `authorDisplayName` and `authorUsername` (from `recipes.author_handle` and `recipes.author_username`). A photo address carries neither id (Photo addresses).

Validation:

- `id` is a UUID, the recipe's public id from `recipe_public_ids` (Public id, above, and `016-FR-037`), never the row id. The public read and the public address accept only a current public id, so a row id is not available there. Anything else is not available, never a `400`.
- `slug` is derived from the title by one pure function, and is not stored.
- _(Amended 2026-11-15, ADR-0093.)_ The facts card and source card forms are withdrawn. A Commise-written version is a
  `full` form (`021-FR-003`).
- A full recipe line whose food did not answer has `foodName: null` and keeps its `displayText`. The count of such
  lines is `missingNutritionCount` (FR-008).
- Photos are thumbnails only (FR-026).
- A `full` member needs a `licence`, which no producer can give until 016 ships. So `full` cannot be built yet.

## Photo addresses

_(PR #481 review, 2026-11-26.)_ A photo's address is its stored key (ADR-0064): `recipes/{owner media key}/{recipe media key}/photos/{object id}`, and its thumbnail is the same plus `.thumb.jpg`. Its check copy (`020` data-model §1, `check_key`) is the same plus `.check.jpg`.

- All three are random version 4 UUIDs (`gen_random_uuid()` in SQL, `randomUUID()` from `node:crypto` in Node), never v7, because a v7 UUID carries its creation time: `owner_media_keys.media_key` (one per owner id), `recipes.media_key` (one per recipe, `UNIQUE`), and the object id made at upload. `owner_media_keys` has no time column.
- Every photo uses this form, signed in and signed out, and version archives use the same prefix. Neither the row id nor the owner id appears in it.
- Before erasure, a cook's photos share their owner media key, which names no one. At erasure, each kept recipe gets fresh keys and fresh object ids (closure plan U3b, Photos).

## Erased owner

**The erasure marker** is `recipes.author_erased boolean NOT NULL DEFAULT false`. It is set `true` once, as the last write of the recipe's own erasure transaction, after the scrub, the photo repoint and any renewal in that transaction (`016-FR-037`, closure plan U3b), and it is never cleared.

A CHECK ties it to an `erased_` owner token and NULL `author_handle` and `author_username`. It carries no user id and no time.

A recipe with `author_erased` projects `author: { kind: 'former' }`. While an erasure waits, the recipe keeps its name (spec Q3). Every other mention of "the erasure's marker" means this column.

The order, stated once: (1) Erasure pending, including the 14-day donation wait (`020-FR-018a`): the recipe is readable with the cook's name (spec Q3). (2) Erasure running: the recipe still reads with the cook's name, unless the erasure notice hides it (`016-FR-012a`, `016` data-model §16). (3) The recipe's own erasure transaction commits (one per kept recipe, closure plan U3b, Order): the owner, the text, the photos, any public id and the marker change together, and the recipe reads "a former member".

## Public id

_(Owner ruling 2026-11-21.)_ A recipe's public id is stored in its own table, `recipe_public_ids`, in recipe-service's database. It is the only id on a public surface. The recipe's row id (`recipes.id`) never appears on one.

| Column      | Type   | Rule                                                                 |
| ----------- | ------ | -------------------------------------------------------------------- |
| `public_id` | `uuid` | primary key, a random version 4 UUID (`gen_random_uuid()`), never v7 |
| `recipe_id` | `uuid` | `NOT NULL`, `UNIQUE`, references `recipes(id)` `ON DELETE CASCADE`   |

- One current id per recipe (`UNIQUE (recipe_id)`). The unique index serves the lookup from recipe to public id. The primary key serves the lookup from public id to recipe.
- It is made with the recipe. An `AFTER INSERT` trigger on `recipes` adds the row in the same transaction, whichever path inserted the recipe. The first public id is a new id, never the row id. If it were the row id, a renewal would retire an id that the in-app address still accepts, and the old named address would reach the renamed recipe.
- Deleting the recipe row removes its public id (cascade). A soft delete keeps it, and the rule closes the read.
- Renewal (`016-FR-037`, a name scrubbed from the title) is one transaction: insert the old id into `recipe_retired_public_ids`, delete the old row, insert a new row. The `UNIQUE` is not deferrable, so the delete comes before the insert.
- `recipe_retired_public_ids` has one column, `public_id uuid` primary key. It has no recipe id, no foreign key and no time, so nothing links it to a recipe. Neither table has a timestamp.
- Two reads resolve an `{id}`. The public read and the public address accept only a current public id. A retired id answers `410` there, and a row id or anything else answers `404`. `/{locale}/recipe/{rowId}/…` answers `404` (the not-available page), never a redirect. Only the signed-in in-app read accepts a row id, and it accepts a current public id too. For a recipe with the erasure marker it accepts only the current public id. A retired id answers `404` there. No recipe is read for a retired id.
- Both tables are created by the migrator as the owner role. The service role gets the default data rights (ADR-0039). The migration is owed to plan U4.

## Public recipe address

A Value Object with one pure parser, `parsePublicRecipePath`.

| Part   | Rule                                                                   |
| ------ | ---------------------------------------------------------------------- |
| prefix | `/{locale}/recipe/`, with a shipped locale (owner 2026-11-20)          |
| `id`   | a UUID                                                                 |
| `slug` | optional. Lower-case words joined by single dashes, derived from title |

A path that does not parse is not a public recipe address. The page ignores the query string. The middleware strips every parameter FR-015 does not allow, and measurement reads only the share mark's presence.

## Page language

The language of the page's own words is the locale in the address, a member of the closed set of shipped locales
(spec FR-015a, owner 2026-11-20). It is part of the path, and so of the cache key (FR-015). A locale-less
address redirects to the locale `Accept-Language` negotiates, else `en-US` (U12). The recipe's own text is never translated.

## Public-reader token

A short-lived EdDSA JWT that recipe-service signs, with one audience, food's. The exact claims
are in [contracts/publicReaderToken.md](contracts/publicReaderToken.md). It names no user and no recipe.

## Pending action

A value from a closed set, `save`, `saveCopy` or `rate`, carried as `?then=` in the sign-in return path `/{locale}/recipes/{id}`. Parsed like `?done=`. A value
outside the set is ignored. Not stored on the device.
