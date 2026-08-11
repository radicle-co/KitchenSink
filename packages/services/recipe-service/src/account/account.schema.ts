/**
 * AUTHORED WIRE CONTRACT for the account vertical — GDPR export (Art. 15/20) and erasure (Art. 17).
 *
 * SOURCE OF TRUTH for these shapes. Copied verbatim into `@kitchensink/schema-recipe`, so it may import ONLY
 * `zod`, `@kitchensink/recipe-core`, and flat sibling `*.schema.js` modules — enforced by
 * `@kitchensink/contract-gen`'s import restriction (configured in `contract/generate.ts`).
 *
 * DESIGN PATTERN: single-source schema + inferred type, plus one Specification predicate
 * ({@link matchesAccountErasureConfirmation}) that BOTH the server's gate and the UI's confirm button run.
 *
 * ⚠️ THIS IS THE HIGHEST-RISK CONTRACT IN THE SERVICE. Erasure is IRREVERSIBLE and the export is the widest
 * personal-data egress surface the service has. Read the three notes below before changing anything here.
 *
 * ── 1. THE INTENT GATE HAD TWO REPRESENTATIONS. IT NOW HAS ONE. ──
 *
 * {@link ACCOUNT_ERASURE_CONFIRMATION_PHRASE} was declared in the service's `dto/erasure.dto.ts` AND,
 * independently, in `@commise/features-account/src/erasure.ts` — together with two implementations of the
 * match rule (`assertConfirmationPhrase` server-side, `confirmsErasurePhrase` client-side). Two copies of the
 * gate on an unrecoverable action, reconciled by nothing but a test in each package asserting the literal
 * `'ERASE MY DATA'`. Drift between them would `400` every erasure in the product while both suites stayed
 * green — the UI would enable its confirm button for a phrase the server rejects, or vice versa.
 *
 * Both the constant and the RULE live here now, and this file is published, so the server's gate and the UI's
 * gate are the same function. `assertConfirmationPhrase` and `confirmsErasurePhrase` survive as thin adapters
 * (a throwing one and a boolean one) over it — the same shape as ADR-0009's sign-out command, and for the same
 * reason: a fix to one side cannot miss the other.
 *
 * ── 2. THE REQUEST SCHEMA VALIDATES THE PHRASE'S *SHAPE*, NEVER ITS *VALUE*. ──
 *
 * {@link erasureRequestSchema} bounds `confirmationPhrase` as a non-empty, length-capped string and stops
 * there. It is tempting to "tighten" it to `z.literal(ACCOUNT_ERASURE_CONFIRMATION_PHRASE)`, and that would be
 * a regression on three counts:
 *
 *   - the pipe runs BEFORE the controller, so the gate would move out of `ErasureService`, which is also the
 *     only layer that runs for a request sent with NO BODY AT ALL (which bypasses the pipe entirely);
 *   - the `400` body would become a zod issue list instead of the service's deliberate
 *     "The confirmation phrase does not match." — which does NOT echo the expected phrase, because a
 *     confirmation a client can learn by guessing once is not a confirmation;
 *   - `openapi.yaml` would publish the phrase as an `enum`, turning the ritual into a documented constant.
 *
 * The split is the same one `photos.schema.ts` makes for the MIME allowlist, and it is pinned by a test that
 * asserts a well-formed but WRONG phrase PASSES this schema.
 *
 * ── 3. THERE IS NO REQUEST BODY FOR THE SERVICE-PRINCIPAL ROUTE, AND THERE MUST NEVER BE ONE. ──
 *
 * `POST /api/v1/internal/account/erasure` takes NO body: the target owner is the signed token's bound claim,
 * so there is no `ownerId` to smuggle past it and no confirmation phrase (the token IS the authorization).
 * Only its RESPONSE is described here ({@link serviceErasureAcceptedResponseSchema}). A request schema for
 * that route would be the first step toward accepting a target from the caller. Do not add one — a contract
 * test asserts the handler has no body parameter.
 */
import { z } from 'zod';

// ── The erasure intent gate ───────────────────────────────────────────────────────────────────────

/**
 * The exact phrase a client MUST send to confirm an irreversible erasure (U7).
 *
 * THE single authoritative copy: the server's gate and both platforms' confirm-button predicate resolve to
 * this literal. Published (rather than kept private) precisely so the UI can render the phrase it is asking
 * the user to type without re-declaring it.
 */
export const ACCOUNT_ERASURE_CONFIRMATION_PHRASE = 'ERASE MY DATA';

/**
 * The permanence warning the donate-election UI (U4b) MUST show beside every "publish instead of delete"
 * choice (CR-002 / U3b).
 *
 * A donated recipe is flipped to public + published as part of an IRREVERSIBLE erasure and is thereafter
 * attributed to a pseudonymous handle the erased owner no longer controls — so they can never edit or take it
 * down. This is the canonical ENGLISH text the per-platform UI localizes; it is contract because the consent
 * it documents is what makes the election lawful, not because a client renders this exact string.
 */
export const ACCOUNT_ERASURE_PUBLISH_WARNING =
    'Recipes you choose to publish become public and are permanently unremovable by you once your account is erased.';

/** Upper bound on the accepted phrase length — a confirmation, not a payload. */
export const MAX_CONFIRMATION_PHRASE_LENGTH = 100;

/**
 * Upper bound on how many recipes one request may elect to publish. A generous cap a real corpus will not
 * approach, present only so a single request cannot smuggle an unbounded array into the durable job row (a
 * payload-size / DoS guard, not a product limit).
 */
export const MAX_PUBLISH_ELECTION_SIZE = 1000;

/**
 * Whether `input` confirms the erasure — the ONE match rule, run by the server's gate and by both platforms'
 * confirm-button predicate.
 *
 * Surrounding whitespace is TOLERATED (a paste artefact is not a different intent); case is NOT (the value of
 * a confirmation ritual is that it is deliberate), and neither is interior whitespace, truncation, or
 * extension. Pure.
 *
 * @param input - The phrase the user typed.
 * @returns True when it confirms the erasure.
 */
export function matchesAccountErasureConfirmation(input: string): boolean {
    return input.trim() === ACCOUNT_ERASURE_CONFIRMATION_PHRASE;
}

/**
 * Body of `POST /api/v1/account/erasure`.
 *
 * `confirmationPhrase` is REQUIRED — see note 2 above for why its VALUE is checked in the service and not
 * here. There is deliberately no `ownerId` field: the owner comes from the verified token, so zod strips a
 * smuggled one before the service sees it.
 */
export const erasureRequestSchema = z.object({
    /** The confirmation phrase gating the erasure. SHAPE-bounded here; the value is the service's `400`. */
    confirmationPhrase: z.string().min(1).max(MAX_CONFIRMATION_PHRASE_LENGTH).meta({
        description:
            'The exact confirmation phrase. Required. A non-matching value is answered 400 by the service, not by request validation — the accepted literal is deliberately not published as an enum.',
    }),
    /**
     * The per-recipe DONATE election (CR-002 / U3b): ids of the caller's OWNER-ONLY recipes elected to be
     * PUBLISHED (donated — flipped to `public` + `published`, surviving the erasure attributed to a pseudonym
     * the erased owner no longer controls) instead of removed. Absent/empty ⇒ donate nothing, so every
     * owner-only recipe is removed (the default).
     *
     * Each entry is a UUID (the `recipes.id` shape). The worker additionally scopes the publish-flip to
     * `owner_id = caller`, so an id the caller does not own — or one already public — is a harmless no-op
     * rather than a way to publish another user's recipe.
     */
    publishRecipeIds: z.array(z.uuid()).max(MAX_PUBLISH_ELECTION_SIZE).readonly().optional(),
});

/** Request body for the user-initiated account erasure. */
export type ErasureRequest = z.infer<typeof erasureRequestSchema>;

// ── Erasure job status (the WIRE enum; the drizzle arrays defer to it) ────────────────────────────

/**
 * The lifecycle statuses an `account_erasure_jobs` row can hold, as the WIRE reports them.
 *
 * DECLARED HERE, and the drizzle column's array is tied to it with `satisfies` rather than the other way
 * round. That inverts the previous dependency, which had the response DTOs importing
 * `ActiveErasureJobStatus` from `database/schema/account.ts` — i.e. a STORAGE type deciding the contract.
 * That import is exactly the leak `@kitchensink/contract-gen`'s guard exists to catch: this file is copied
 * into a package `@commise/web` and `@commise/mobile` depend on, where `../database/schema/account.js` does
 * not resolve and `drizzle-orm` must never arrive.
 *
 * The DB `CHECK` still needs a plain array, so the array stays in the drizzle file — it just derives its
 * type from here now, and a divergence fails the build there.
 */
export const erasureJobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed']);

/** A lifecycle status of an account-erasure job. */
export type ErasureJobStatus = z.infer<typeof erasureJobStatusSchema>;

/**
 * The IN-FLIGHT subset. A `202` is only ever returned for a job that is `queued` (newly enqueued, or a fresh
 * retry after a failure) or `running` (returned idempotently for a duplicate request) — a terminal status is
 * reported some other way (`410 ALREADY_ERASED` on the user path, an idempotent `completed` no-op on the
 * service path), so narrowing here is what makes the two acceptance bodies say different, true things.
 */
export const activeErasureJobStatusSchema = z.enum(['queued', 'running']);

/** An in-flight status of an account-erasure job. */
export type ActiveErasureJobStatus = z.infer<typeof activeErasureJobStatusSchema>;

/**
 * The `202` body of `POST /api/v1/account/erasure`: the id of the erasure job now in flight for the caller.
 *
 * `{ jobId, status }` and NOTHING else — any extra field here would be silent contract drift, and a unit test
 * asserts the emitted key set exactly. `readonly`, like every response body in this contract.
 */
export const erasureRequestAcceptedResponseSchema = z
    .object({
        /** The erasure job's id (`account_erasure_jobs.id`, a UUID). */
        jobId: z.string().min(1),
        /** `queued` for a newly enqueued job; `running` when an in-progress job is returned idempotently. */
        status: activeErasureJobStatusSchema,
    })
    .readonly();

/** The `202` acceptance body for a user-initiated erasure. */
export type ErasureRequestAcceptedResponse = z.infer<typeof erasureRequestAcceptedResponseSchema>;

/**
 * The `202` body of `POST /api/v1/internal/account/erasure` (CR-002 / U4a).
 *
 * Kept SEPARATE from {@link erasureRequestAcceptedResponseSchema}, and the difference is load-bearing rather
 * than incidental: the service path reports the audit `triggerSource`, and — unlike the user path, which
 * raises `410` for an already-erased account — treats a prior completed erasure as an idempotent no-op
 * SUCCESS. So this body admits a terminal `status` and its `jobId` is OPTIONAL: for an already-erased
 * account the completed job exists but its id is not surfaced, because the deletion-worker caller only needs
 * to know the erasure is handled.
 *
 * `triggerSource` is a `z.literal('service')` rather than `recipe-core`'s `ERASURE_TRIGGER_SOURCES` enum: this
 * route can only ever be reached with a machine token, so `'user'` is not a value it can return. A single
 * literal is not a second declaration of that enum — it is a narrowing, and publishing the whole enum here
 * would advertise a response the route cannot produce.
 */
export const serviceErasureAcceptedResponseSchema = z
    .object({
        /**
         * The erasure job's id. Present when a job was created or is already in flight; ABSENT for an
         * already-erased account.
         */
        jobId: z.string().min(1).optional(),
        /** `queued`/`running` when accepted, `completed` when the account was already erased. */
        status: erasureJobStatusSchema,
        /** Always `'service'` — the R8 trigger source attributed to this erasure. */
        triggerSource: z.literal('service'),
    })
    .readonly();

/** The `202` acceptance body for a service-principal erasure. */
export type ServiceErasureAcceptedResponse = z.infer<typeof serviceErasureAcceptedResponseSchema>;

// ── The account export document ───────────────────────────────────────────────────────────────────

/**
 * An id as the export document carries it.
 *
 * `z.string().min(1)` and NOT `z.uuid()`, deliberately: the document mixes app-user ULIDs (`ownerId`,
 * `userId`, `createdBy`) with row UUIDs (`id`, `recipeId`), so one uniform `z.uuid()` would be false of half
 * the fields, and splitting per field would re-encode a ULID-vs-UUID distinction a portability document does
 * not care about. This matches how `@kitchensink/recipe-core` treats every id in `recipeSchema` and
 * `collectionSchema`.
 */
const exportIdSchema = z.string().min(1);

/**
 * A `timestamptz` as the export document carries it: an ISO-8601 string.
 *
 * NOT `recipe-core`'s `isoDateTimeSchema`, and the reason is a real one rather than an oversight — see
 * {@link accountExportSchema}'s note on `null`. Every timestamp in this document has a NULLABLE sibling
 * (`deletedAt`, `lastPulledAt`) that must be `T | null` rather than optional, so the nullable variant is
 * built here from the same base; using recipe-core's alias for the non-null half and building the other half
 * locally would split one rule across two files.
 */
const exportTimestampSchema = z.string().min(1);

/**
 * A single owner-scoped recipe (the `recipes` golden row), including tombstoned/draft/private rows.
 *
 * Numeric columns that Postgres returns as strings (`averageRating`, `leadCaloriesPerServing` — both
 * `numeric`) are published AS STRINGS, which is what the mapper emits. That is a faithful mirror of the row
 * and deliberately unlike the read-path projection, which coerces them to numbers: a portability document
 * reports what is stored, and a lossy re-encode of a `numeric` is exactly the kind of quiet change an export
 * must not make.
 */
export const recipeExportSchema = z
    .object({
        id: exportIdSchema,
        /** The owner's app-user ULID (`recipes.owner_id`) — always the caller. */
        ownerId: exportIdSchema,
        title: z.string(),
        description: z.string().nullable(),
        prepTimeMinutes: z.number().int(),
        cookTimeMinutes: z.number().int(),
        totalTimeMinutes: z.number().int(),
        servings: z.number().int(),
        /** Author-stated difficulty (`easy`/`medium`/`hard`), or `null` when not stated. */
        difficulty: z.string().nullable(),
        /** Denormalized rating aggregate (`numeric` → string), `null` when unrated. */
        averageRating: z.string().nullable(),
        ratingCount: z.number().int(),
        visibility: z.string(),
        status: z.string(),
        sourceType: z.string(),
        sourceUrl: z.string().nullable(),
        sourceAttribution: z.string().nullable(),
        /** Clone provenance: the recipe this was cloned FROM, or `null` for an original. */
        clonedFromId: exportIdSchema.nullable(),
        hasSubstantiveEdit: z.boolean(),
        cuisine: z.string().nullable(),
        dietaryFlags: z.array(z.string()).readonly(),
        tags: z.array(z.string()).readonly(),
        hasPartialNutrition: z.boolean(),
        /** Denormalized headline per-serving calories (`numeric` → string), `null` when unaccounted. */
        leadCaloriesPerServing: z.string().nullable(),
        authorHandle: z.string().nullable(),
        currentVersion: z.number().int(),
        /** Soft-delete tombstone, or `null` when active. Present so an export is a faithful mirror. */
        deletedAt: exportTimestampSchema.nullable(),
        createdAt: exportTimestampSchema,
        updatedAt: exportTimestampSchema,
    })
    .readonly();

/** One owner-scoped recipe in the export. */
export type RecipeExport = z.infer<typeof recipeExportSchema>;

/**
 * One recipe's membership in a collection (a `recipe_collections` junction row).
 *
 * NOTE the field is `addedAt` here, while the collections endpoint's membership RESPONSE calls the same
 * column `createdAt`. Both are faithful to their own contract — the export mirrors the row, the endpoint
 * echoes a shipped wire name — and neither is renamed to match the other, because either rename is a
 * breaking change to a live consumer. Recorded rather than quietly reconciled.
 */
export const collectionMembershipExportSchema = z
    .object({
        recipeId: exportIdSchema,
        addedAt: exportTimestampSchema,
        /** Provenance of how it entered the collection (`manual`/`clone_seed`/`pull`). */
        addedVia: z.string(),
    })
    .readonly();

/** One collection membership in the export. */
export type CollectionMembershipExport = z.infer<typeof collectionMembershipExportSchema>;

/** A single owner-scoped collection (the `collections` row) with its memberships embedded. */
export const collectionExportSchema = z
    .object({
        id: exportIdSchema,
        ownerId: exportIdSchema,
        name: z.string(),
        description: z.string().nullable(),
        visibility: z.string(),
        /** Clone provenance: the collection this was cloned FROM, or `null` for an original. */
        sourceCollectionId: exportIdSchema.nullable(),
        /** Last pull-refresh time, or `null` if never pulled. */
        lastPulledAt: exportTimestampSchema.nullable(),
        sourceOwnerHandle: z.string().nullable(),
        sourceCollectionName: z.string().nullable(),
        createdAt: exportTimestampSchema,
        updatedAt: exportTimestampSchema,
        /** The recipes in this collection (its `recipe_collections` junction rows). */
        recipes: z.array(collectionMembershipExportSchema).readonly(),
    })
    .readonly();

/** One owner-scoped collection in the export. */
export type CollectionExport = z.infer<typeof collectionExportSchema>;

/** A single rating the owner authored on ANY recipe (a `recipe_ratings` row keyed by `user_id`). */
export const ratingExportSchema = z
    .object({
        id: exportIdSchema,
        /** The rated recipe's id — may belong to another user. */
        recipeId: exportIdSchema,
        /** The rater's app-user ULID (`recipe_ratings.user_id`) — always the caller. */
        userId: exportIdSchema,
        stars: z.number().int(),
        createdAt: exportTimestampSchema,
        updatedAt: exportTimestampSchema,
    })
    .readonly();

/** One rating the owner authored, in the export. */
export type RatingExport = z.infer<typeof ratingExportSchema>;

/**
 * Metadata (never the bytes) for one photo attached to an owner's recipe (a `recipe_photos` row).
 *
 * Both the object KEY and its resolved CDN URL are included; the image bytes are not. A consumer exercising
 * portability fetches the URLs itself, which keeps the document a JSON document.
 */
export const photoExportSchema = z
    .object({
        id: exportIdSchema,
        recipeId: exportIdSchema,
        /** The full-size object's S3 key. */
        key: z.string().min(1),
        /** The resolved CDN URL of the full-size object. */
        url: z.url(),
        /** The cover-thumbnail rendition's S3 key, or `null` when the photo has no thumbnail. */
        thumbnailKey: z.string().min(1).nullable(),
        /** The resolved CDN URL of the thumbnail rendition, or `null` when there is none. */
        thumbnailUrl: z.url().nullable(),
        contentType: z.string(),
        sizeBytes: z.number().int().nullable(),
        /** The 0-based stored display order (`recipe_photos.sort_order`). */
        sortOrder: z.number().int(),
        createdAt: exportTimestampSchema,
        updatedAt: exportTimestampSchema,
    })
    .readonly();

/** One photo's metadata in the export. */
export type PhotoExport = z.infer<typeof photoExportSchema>;

/** Metadata (never the snapshot blob) for one version of an owner's recipe (a `recipe_versions` row). */
export const versionExportSchema = z
    .object({
        id: exportIdSchema,
        recipeId: exportIdSchema,
        versionNumber: z.number().int(),
        /** The base version this one was authored against (3-way merge), or `null`. */
        baseVersion: z.number().int().nullable(),
        /** The S3 archive key for the snapshot, or `null` when DB-only so far. */
        s3Key: z.string().min(1).nullable(),
        /** The version's author (`recipe_versions.created_by`, the app-user ULID) — always the caller. */
        createdBy: exportIdSchema,
        changeSummary: z.string().nullable(),
        deviceLabel: z.string().nullable(),
        editorHandle: z.string().nullable(),
        createdAt: exportTimestampSchema,
    })
    .readonly();

/** One recipe version's metadata in the export. */
export type VersionExport = z.infer<typeof versionExportSchema>;

/** The owner's author-handle read-model row(s) (`author_handles`, keyed by `user_id`). */
export const authorHandleExportSchema = z
    .object({
        /** The owner's app-user ULID (`author_handles.user_id`) — always the caller. */
        userId: exportIdSchema,
        displayName: z.string(),
        /** The source timestamp the monotonic handle-sync guard compares. */
        sourceTimestamp: exportTimestampSchema,
    })
    .readonly();

/** One author-handle row in the export. */
export type AuthorHandleExport = z.infer<typeof authorHandleExportSchema>;

/**
 * The complete `GET /api/v1/account/export` document: every recipe-domain personal-data root the caller owns,
 * as one structured, machine-readable JSON payload (Art. 20 portability).
 *
 * It is the read-only INVERSE of the erasure worker: it returns exactly the owner-scoped roots erasure
 * hard-deletes or keeps, so "what we hold about you" equals "what erasure removes/keeps". Every root is
 * REQUIRED and an empty one is `[]` — a brand-new account produces a fully-shaped document with seven empty
 * arrays, never a document with keys missing.
 *
 * ⚠️ TWO SHAPE DECISIONS THAT DIFFER FROM THE API'S READ CONTRACTS, both deliberate and both load-bearing:
 *
 *  - **Absent values are an explicit `null`, not an omitted key.** The recipe read-path Data Mapper OMITS
 *    nulls; a portability document benefits from a STABLE, fully-declared shape a consumer can rely on
 *    field-for-field. So `nullable()` appears throughout where the read contracts use `optional()`, and the
 *    two are not interchangeable: `optional()` here would let a consumer's field-for-field mapping silently
 *    skip a column.
 *  - **`numeric` columns stay strings.** See {@link recipeExportSchema}.
 *
 * `ownerId` echoes the VERIFIED token owner the export was scoped to (never a client-supplied value), so the
 * document self-documents whose data it contains.
 */
export const accountExportSchema = z
    .object({
        /** When this export was generated. */
        exportedAt: exportTimestampSchema,
        /** The verified owner (app-user ULID) whose data this document contains. */
        ownerId: exportIdSchema,
        recipes: z.array(recipeExportSchema).readonly(),
        collections: z.array(collectionExportSchema).readonly(),
        ratings: z.array(ratingExportSchema).readonly(),
        photos: z.array(photoExportSchema).readonly(),
        versions: z.array(versionExportSchema).readonly(),
        authorHandles: z.array(authorHandleExportSchema).readonly(),
    })
    .readonly();

/** The complete account-export document. */
export type AccountExport = z.infer<typeof accountExportSchema>;
