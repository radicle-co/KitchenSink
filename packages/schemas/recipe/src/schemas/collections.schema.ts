/*
 * ⚠️ GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from the recipe service, which AUTHORS the wire contract. Edit the
 * source and regenerate: `npm run contract:generate --workspace=@kitchensink/recipe-service`.
 *
 * CI fails on any difference between this directory and a fresh regeneration, so a hand-edit here is
 * discarded rather than shipped.
 */
// Source: packages/services/recipe-service/src/collections/collections.schema.ts

/**
 * AUTHORED WIRE CONTRACT for the collections vertical (`/api/v1/collections…`) — requests AND responses.
 *
 * SOURCE OF TRUTH for these shapes. Copied verbatim into `@kitchensink/schema-recipe`, so it may import ONLY
 * `zod`, `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules — enforced by
 * `@kitchensink/contract-gen`'s import restriction (configured in `contract/generate.ts`).
 *
 * DESIGN PATTERN: single-source schema + inferred type, composed with Value Objects from `recipe-core`. The
 * request halves are adapted into Nest through `dto/*.dto.ts` (`createZodDto`), so the shape the validation
 * pipe enforces and the shape the contract publishes are ONE OBJECT, not two that agree today.
 *
 * ── WHAT THIS FILE REPLACED, AND THE FOUR DRIFTS IT SETTLED ──
 *
 * Before it, the collections contract had FIVE independent homes: `collections.schemas.ts` (request zod),
 * `collections.types.ts` (hand-written response interfaces), `domain/pull-diff.ts` (the diff shape), the typed
 * client's `types.ts`, and a second zod copy inside the client's `client.ts`. Four of them had already drifted:
 *
 *  1. **`recipes` on the collection-with-recipes body.** The client declared it OPTIONAL, the server REQUIRED.
 *     Resolved in the SERVER's favour — required — because `CollectionsService.getCollection` sets it
 *     unconditionally, so "absent" was never a state the server could produce. Declaring it optional invited a
 *     client to render "recipes not loaded" for a case that cannot happen, and forced a `?? []` on every read.
 *  2. **`visibility` on the UPDATE request.** The server's `UpdateCollectionInput` typed it a raw `string`,
 *     deliberately, so the service would be an independent enforcement point (FR-010 / T140). The reasoning was
 *     sound and the placement was not: that is a statement about the SERVICE's input, and the WIRE has always
 *     been the narrowed enum (the controller's request schema already rejected anything else with a `400`).
 *     Resolved toward the narrowed enum here, and the service keeps its runtime guard — now written as a TYPE
 *     ASSERTION so the check informs the type system instead of contradicting it. Defense in depth survives; a
 *     wire type that admitted `'unlisted'` does not.
 *  3. **`visibility`'s TYPE.** The server took it from drizzle (`CollectionVisibility`, `database/schema/
 *     collections.ts`); the client took it from `recipe-core` (`RecipeVisibility`). A drizzle enum is a STORAGE
 *     type — it exists to describe a column — and it must not be the wire type: it would either fail to resolve
 *     inside the copied schema package or drag `drizzle-orm` into the React Native bundle. Resolved toward
 *     `recipe-core`, which is where the domain value set belongs, and which the drizzle enum itself already
 *     defers to (`COLLECTION_VISIBILITIES … satisfies readonly RecipeVisibility[]`).
 *  4. **A stale claim.** `collections.types.ts` documented that recipe-core's `Collection` "intentionally omits
 *     `visibility` and `recipeCount`", which is why the response shapes were hand-written here. It now has
 *     both, so the justification for the second declaration had evaporated and only the second declaration
 *     remained. Composing recipe-core is what this file does instead.
 *
 * ── WHY THIS COMPOSES `recipe-core` INSTEAD OF RE-DECLARING ──
 *
 * `collectionSchema` in `@kitchensink/recipe-core` already owns the collection entity, and 78 service files +
 * 13 client files import from that package. Re-declaring `Collection` here to make this file literally
 * zod-only would manufacture exactly the drift §15 exists to prevent. recipe-core is admitted to the schema
 * package's import allowlist because it is itself a leaf whose only runtime dependency is `zod`.
 *
 * ── STRICT REQUESTS, LOOSE-BY-EXEMPTION QUERY, AND THE ONE SHAPE THAT IS BOTH ──
 *
 * The five request bodies (`create`, `update`, `addRecipe`, `clone`, `pullFromSource`) are `z.strictObject`
 * per GR-017 §17-c: an unknown key on a mutating body is a `400` the caller can fix, never a `200` that wrote
 * something else. Two shapes here are deliberately NOT strict, and each carries its reason at the schema:
 *
 *  • {@link listCollectionsQuerySchema} — a READ query (the §17-c exemption; see
 *    `recipes.schema.ts`'s `listRecipesQuerySchema` for the full argument, stated once there).
 *  • {@link pullDiffSchema} — the ONE shape in this contract that is BOTH a response body and a request
 *    field, which is what makes it the interesting case. See its own note.
 *
 * `updateCollectionRequestSchema` keeps its `.refine()` on top of the strict object, and the two rejections
 * stack rather than overlap: `{}` fails the refine ("at least one field"), `{ nmae: 'x' }` now fails as an
 * unrecognized key. It previously answered the SECOND case with the FIRST message — the key was stripped, the
 * object became empty, and the caller was told "at least one field must be provided" while having provided
 * one. That is a real diagnostic improvement, not just a policy change.
 *
 * ── `readonly`, AND THE ONE PLACE IT STOPS ──
 *
 * Response bodies are `readonly` throughout: a parsed body is a snapshot of what the server said, and a
 * consumer mutating it in place corrupts a value other consumers (and the query cache) share. Note that
 * `z.infer` does NOT produce `readonly` for the members of a composed shape — the same widening the food and
 * identity contracts accepted rather than introducing a deep-readonly wrapper, which would be a second
 * representation of the shape. Same call here, stated rather than hidden. {@link collectionListResponseSchema}
 * is the deliberate exception at the OUTER level: it is `recipe-core`'s `paginatedResponseSchema`, whose
 * `PaginatedResponse<T>.data` is a mutable `T[]` shared by every paginated endpoint in the API, so wrapping it
 * would fork the envelope for one vertical.
 */
import { z } from 'zod';

import {
    collectionSchema,
    isoDateTimeSchema,
    paginatedResponseSchema,
    recipeCollectionAddedViaSchema,
    recipeSchema,
    recipeVisibilitySchema,
} from '@kitchensink/recipe-core';

/**
 * Max length of a collection name. Bounds the request body; the column itself is unbounded `text`, so this is
 * the only place the limit exists and it is therefore contract, not decoration.
 */
export const MAX_COLLECTION_NAME_LENGTH = 120;

/** Max length of a collection description. Same reasoning as {@link MAX_COLLECTION_NAME_LENGTH}. */
export const MAX_COLLECTION_DESCRIPTION_LENGTH = 1000;

/**
 * A collection name as a request accepts it.
 *
 * ⚠️ `.min(1)` is not cosmetic — `recipe-core`'s `collectionSchema.name` is `min(1)`, and every
 * collection-returning client method parses its response with it. A server that accepted `''` would store a
 * body no client could read back.
 */
const collectionNameSchema = z.string().min(1).max(MAX_COLLECTION_NAME_LENGTH);

/**
 * A collection description as a request accepts it.
 *
 * `.min(1)` for the same reason as {@link collectionNameSchema}, and it is a REAL fix rather than a
 * tightening for tidiness: the previous bound was `.max(1000)` only, so `{ "description": "" }` was accepted,
 * persisted as a non-NULL empty string, and echoed back — straight into a client parse (`collectionSchema`'s
 * `description: z.string().min(1).optional()`) that rejects it. The two sides now agree, and the disagreement
 * is answered at the request boundary with a `400` instead of at the response boundary with a client throw.
 * An absent description remains the way to say "no description"; `null` is the row, never the wire.
 */
const collectionDescriptionSchema = z.string().min(1).max(MAX_COLLECTION_DESCRIPTION_LENGTH);

// ── Requests ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Body of `POST /api/v1/collections`.
 *
 * `ownerId` is deliberately absent and unaccepted: ownership comes from the verified principal, so there is no
 * field for a caller to smuggle one through. The STRICT object refuses a hostile `ownerId` with a `400` before
 * the service sees it — asserted in `dto/__tests__/collection-dtos.test.ts`. It used to be stripped, which is
 * equally safe for the SERVER and worse for the caller, who was told nothing.
 */
export const createCollectionRequestSchema = z.strictObject({
    name: collectionNameSchema,
    description: collectionDescriptionSchema.optional(),
    /** Defaults to `private` SERVER-side (FR-010) rather than here, so an omitted field stays distinguishable. */
    visibility: recipeVisibilitySchema.optional(),
});

/** Request body for creating a collection. */
export type CreateCollectionRequest = z.infer<typeof createCollectionRequestSchema>;

/**
 * Body of `PATCH /api/v1/collections/{id}` — a partial update requiring at least one field.
 *
 * ⚠️ The at-least-one-field rule is a `.refine()`, and zod's JSON Schema conversion cannot represent a custom
 * check, so `openapi.yaml` carries it as prose in the operation description rather than as `minProperties: 1`.
 * That gap is stated here because the alternative — dropping the rule to keep the document mechanically
 * complete — would turn a client bug (a PATCH that changes nothing) into a silent success.
 */
export const updateCollectionRequestSchema = z
    .strictObject({
        name: collectionNameSchema.optional(),
        description: collectionDescriptionSchema.optional(),
        visibility: recipeVisibilitySchema.optional(),
    })
    .refine((value) => Object.keys(value).length > 0, { message: 'At least one field must be provided.' });

/** Request body for updating a collection. */
export type UpdateCollectionRequest = z.infer<typeof updateCollectionRequestSchema>;

/** Body of `POST /api/v1/collections/{id}/recipes`. */
export const addRecipeToCollectionRequestSchema = z.strictObject({
    /** The recipe to add. Any UUID version — `recipes.id` is `uuid` and the service re-resolves it anyway. */
    recipeId: z.uuid(),
});

/** Request body for adding a recipe to a collection. */
export type AddRecipeToCollectionRequest = z.infer<typeof addRecipeToCollectionRequestSchema>;

/**
 * Body of `POST /api/v1/collections/{id}/clone` (FR-011) — both fields optional, so the BODY is optional.
 *
 * `.default({})` is what makes a bodyless `POST` legal, and it is deliberately on the SCHEMA rather than in a
 * pipe wrapper: it replaced a bespoke `z.preprocess(v => v ?? {})` helper that existed only because the
 * hand-rolled pipe could not express "absent means no overrides". A `.default` is representable in JSON
 * Schema; a `preprocess` is a transform and would fail the document's own conversion.
 *
 * Bounds mirror {@link createCollectionRequestSchema} so a clone can never carry a name the create path would
 * have rejected.
 */
export const cloneCollectionRequestSchema = z
    .strictObject({
        name: collectionNameSchema.optional(),
        description: collectionDescriptionSchema.optional(),
    })
    .default({});

/** Request body for cloning a collection. */
export type CloneCollectionRequest = z.infer<typeof cloneCollectionRequestSchema>;

/**
 * `page` / `pageSize` query of `GET /api/v1/collections`.
 *
 * Coerced, because a query bag is strings on the wire. `.int()` rejects `2.5` rather than truncating it — a
 * silently-truncated page size is a contract that lies about what it did.
 *
 * NOT strict: a READ query, under GR-017 §17-c's exemption. The reasoning is stated once, at
 * `recipes.schema.ts`'s `listRecipesQuerySchema`, rather than repeated here.
 */
export const listCollectionsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Parsed pagination query for listing collections. */
export type ListCollectionsQuery = z.infer<typeof listCollectionsQuerySchema>;

// ── The pull-from-source diff (BOTH directions) ───────────────────────────────────────────────────

/**
 * The three-way pull diff — a partition of `source ∪ clone` (W8-a.8 / owner decision 7).
 *
 * ONE schema serves both directions on purpose, and that is not an accident of convenience: the client echoes
 * back the EXACT document `previewPullFromSource` returned, and the server compares the two for drift. Two
 * schemas could disagree about a field and the drift check would then be comparing different shapes — which is
 * the one failure this endpoint pair exists to prevent. It previously had FOUR declarations (the service's
 * `domain/pull-diff.ts`, the service's request zod, the client's `types.ts`, and a second zod in the client).
 *
 * Buckets are sorted and de-duplicated by the producer (`computePullDiff`), and that ordering is SIGNIFICANT:
 * byte-equality of the sorted buckets is the drift signal. The schema does not re-assert sortedness — a
 * `.refine()` would reject a legitimately-echoed document from a future producer with a different order, and
 * the comparison is the server's job, not the parser's.
 *
 * ⚠️ FORWARD-COMPATIBILITY EXEMPTION from GR-017 §17-c, and this is the one shape in the recipe contract where
 * the exemption is earned by something other than being a read. It is BOTH directions: the `PullDiff` RESPONSE
 * of `previewPullFromSource` and the `previewedDiff` FIELD a client echoes back on commit. So it is subject to
 * both halves of the rule at once, and they point opposite ways — a response must tolerate a field a client has
 * not been taught, while a request body must reject one.
 *
 * The round trip breaks the tie, decisively. Because the client echoes back the EXACT document the server sent,
 * a strict request member would mean: the day the server adds a field to the diff, every in-flight preview →
 * commit sequence `400`s on a body the SERVER ITSELF produced. The client did nothing wrong and has no way to
 * comply — stripping the new field would fail the byte-equality drift check instead. `z.object` makes the
 * addition a no-op for old and new clients alike.
 *
 * The safety the strictness would have bought is already held elsewhere and is not lost: the *drift comparison*
 * is what protects this endpoint (an echoed document that does not match the freshly-derived one is a `409`
 * `PULL_DRIFT`, whatever extra keys it carries), and the enclosing
 * {@link pullFromSourceRequestSchema} IS strict, so a caller who misspells `previewedDiff` itself still gets a
 * `400`. What stays permissive is only the interior of a document the server authored.
 */
export const pullDiffSchema = z
    .object({
        /** Recipes in the source but not the clone — the pull WILL add these. */
        added: z.array(z.string().min(1)).readonly(),
        /** Recipes in the clone but not the source — informational; a pull never removes them. */
        removed: z.array(z.string().min(1)).readonly(),
        /** Recipes in both — already present; the pull is a no-op for these. */
        unchanged: z.array(z.string().min(1)).readonly(),
    })
    .readonly();

/** The three-way pull-from-source diff. */
export type PullDiff = z.infer<typeof pullDiffSchema>;

/**
 * Body of `POST /api/v1/collections/{id}/pull-from-source` (W8-a.8).
 *
 * OPTIONAL `previewedDiff` — the diff the client saw in the preview, echoed back as the drift baseline.
 * Absent means apply directly with no drift guard, which is the back-compatible path for a caller that never
 * previewed. `.default({})` for the same reason as {@link cloneCollectionRequestSchema}.
 */
export const pullFromSourceRequestSchema = z
    .strictObject({
        previewedDiff: pullDiffSchema.optional(),
    })
    .default({});

/** Request body for committing a pull from source. */
export type PullFromSourceRequest = z.infer<typeof pullFromSourceRequestSchema>;

// ── Responses ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The collection body's SHAPE, before `.readonly()` is applied.
 *
 * Exists as a separate binding for a mechanical reason worth stating: zod's `.readonly()` returns a
 * `ZodReadonly`, which has no `.extend()`. {@link collectionWithRecipesResponseSchema} must extend this shape,
 * so the extension happens here and both published views take their `.readonly()` from the same object. There
 * is one authored shape and two views of it, never two shapes.
 *
 * The three added fields are the recipe service's response-only pull-provenance projections, and they are
 * added HERE rather than onto `recipe-core`'s `Collection` because they are this service's read-model, not
 * part of the domain entity every service shares: `lastPulledAt` (last successful pull, W5 Task 3) and
 * `sourceOwnerHandle` / `sourceCollectionName` (the source's attribution, FROZEN at clone time — W5 Task 2,
 * never resynced on a later rename, CR-003). All three are absent for a collection that was never cloned, and
 * `lastPulledAt` is absent for one never pulled.
 */
const collectionResponseShape = collectionSchema.extend({
    sourceOwnerHandle: z.string().min(1).optional(),
    sourceCollectionName: z.string().min(1).optional(),
    lastPulledAt: isoDateTimeSchema.optional(),
});

/**
 * The `Collection` wire body: `POST /collections`, `PATCH /collections/{id}`, `POST /collections/{id}/clone`,
 * and each element of the list envelope.
 *
 * `recipeCount` (inherited from recipe-core) is present on single-collection reads and absent on list reads —
 * the server genuinely omits it there rather than sending `0`, so optional is the honest declaration.
 */
export const collectionResponseSchema = collectionResponseShape.readonly();

/** The `Collection` wire body. */
export type CollectionResponse = z.infer<typeof collectionResponseSchema>;

/** The `GET /api/v1/collections` body — a page of collections. */
export const collectionListResponseSchema = paginatedResponseSchema(collectionResponseSchema);

/** A page of collections. */
export type CollectionListResponse = z.infer<typeof collectionListResponseSchema>;

/**
 * A recipe as it appears inside a collection embed (W5 Task 4): the canonical `Recipe` wire shape plus this
 * member's PROVENANCE, so a client can render the source indicator (C3) without a second membership lookup.
 *
 * `coverPhotoUrl` (inherited, optional) is deliberately never populated on this embed — no cover LATERAL runs
 * for it — so the collection card owns its own no-image visual. That is a property of the read, not of the
 * type, which is why the field stays optional rather than being omitted from the shape.
 */
export const collectionMemberRecipeSchema = recipeSchema
    .extend({
        addedVia: recipeCollectionAddedViaSchema,
    })
    .readonly();

/** A recipe inside a collection embed, carrying its membership provenance. */
export type CollectionMemberRecipe = z.infer<typeof collectionMemberRecipeSchema>;

/**
 * The `GET /api/v1/collections/{id}` body — a collection plus its member recipes.
 *
 * `recipes` is REQUIRED (drift 1). Members are filtered to those the CALLER may view, so an empty array means
 * "nothing you can see", which is a real and fully-represented state — it does not need an absent key to
 * express it, and an absent key would have meant something the server cannot say.
 */
export const collectionWithRecipesResponseSchema = collectionResponseShape
    .extend({
        recipes: z.array(collectionMemberRecipeSchema).readonly(),
    })
    .readonly();

/** A collection plus its (viewable, non-tombstoned) member recipes. */
export type CollectionWithRecipesResponse = z.infer<typeof collectionWithRecipesResponseSchema>;

/**
 * The `POST /api/v1/collections/{id}/recipes` body — the created membership join record.
 *
 * ⚠️ OWNERSHIP NOTE, deliberately not "fixed" here. The wire field is `createdAt`; the persisted column and
 * `recipe-core`'s own `RecipeCollection` domain type both call it `addedAt`. So recipe-core's
 * `recipeCollectionSchema` is NOT this body and must not be substituted for it — composing it would rename a
 * shipped wire field and break every client. The names are reconciled by the service's mapper, and the
 * divergence is recorded rather than silently resolved, because renaming either side is a contract decision.
 */
export const collectionRecipeMembershipResponseSchema = z
    .object({
        collectionId: z.string().min(1),
        recipeId: z.string().min(1),
        addedVia: recipeCollectionAddedViaSchema,
        /** When the recipe entered the collection (the row's `added_at`). */
        createdAt: isoDateTimeSchema,
    })
    .readonly();

/** The created collection-membership record. */
export type CollectionRecipeMembershipResponse = z.infer<typeof collectionRecipeMembershipResponseSchema>;

/**
 * The `POST /api/v1/collections/{id}/pull-from-source` body — the resulting collection plus exactly which
 * recipes this pull added.
 *
 * An empty `addedRecipeIds` is the ordinary "source had nothing new" outcome, not an error. There is
 * deliberately no `removed` field: a pull is ADDITIVE, and recipes the caller can no longer access are
 * filtered at read time rather than deleted, so reporting removals here would describe work that did not
 * happen.
 */
export const pullFromSourceResponseSchema = z
    .object({
        collection: collectionResponseSchema,
        addedRecipeIds: z.array(z.string().min(1)).readonly(),
    })
    .readonly();

/** The result of a pull from source. */
export type PullFromSourceResponse = z.infer<typeof pullFromSourceResponseSchema>;
