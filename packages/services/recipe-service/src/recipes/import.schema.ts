/**
 * THE BULK-IMPORT WIRE CONTRACT (ADR-0072) — authored here and copied to `@kitchensink/schema-recipe` by
 * `contract:generate` (ADR-0014).
 *
 * ⚠️ WHY THIS FILE SITS IN `src/recipes/` AND NOT IN `src/import/`. A `*.schema.ts` may import only zod, the allowlisted
 * leaf packages and a FLAT `./x.schema.js` sibling (`contract/config.ts`), and this contract has to COMPOSE two siblings
 * rather than restate them: the create-recipe bounds (`./recipes.schema.js`, so an editor's counter and the importer agree)
 * and the paste match view (`./parseJobs.schema.js`, so the closed `MatchState` has ONE definition — ADR-0072 §6). The
 * controller, service and DALs live in `src/import/`; only the schema is here, because that is the only directory both
 * siblings share.
 *
 * ## The routes this contract serves (ADR-0072 §1; `importId` is a UUID, parsed as one at the boundary)
 *
 * | Method | Path                                                | Request                              | Answer           |
 * | ------ | --------------------------------------------------- | ------------------------------------ | ---------------- |
 * | `POST` | `/api/v1/import`                                    | {@link createImportRequestSchema}    | `201` view       |
 * | `PUT`  | `/api/v1/import/{importId}/items`                   | {@link putImportItemsRequestSchema}  | `200` view       |
 * | `GET`  | `/api/v1/import/{importId}`                         | query: `after`, `limit`              | `200` view       |
 * | `POST` | `/api/v1/import/{importId}/advance`                 | {@link advanceImportRequestSchema}   | `200` view / `429 IMPORT_QUOTA_EXCEEDED` |
 * | `GET`  | `/api/v1/import/{importId}/steps/{ordinal}`         | —                                    | `200` step       |
 * | `POST` | `/api/v1/import/{importId}/cursor`                  | {@link importCursorRequestSchema}    | `200` view / `409 IMPORT_CURSOR_MOVED` |
 * | `PUT`  | `/api/v1/import/{importId}/items/{ordinal}/pick`    | {@link importPickRequestSchema}      | `200` step       |
 * | `POST` | `/api/v1/import/{importId}/items/{ordinal}`         | {@link recordImportChoicesRequestSchema} | `200` step / `409 IMPORT_ITEM_ALREADY_SAVED` |
 * | `POST` | `/api/v1/import/{importId}/leave`                   | {@link leaveImportRequestSchema}     | `200` view       |
 * | `GET`  | `/api/v1/import/{importId}/flagged`                 | —                                    | `200` flagged    |
 * | `GET`  | `/api/v1/import/{importId}/to-check`                | —                                    | `200` to-check   |
 *
 * ## The rules this contract carries
 *
 *  1. **Requests are strict, responses are loose** (GR-017 §17-c). A key a client invents is a `400`, never a silent strip:
 *     `boundBy` and the derived `sourceType` are written only by the server, and the owner is the principal. A response
 *     tolerates a field a newer server adds.
 *  2. **The server receives recipes, not an archive.** The client reads the export file and sends one structured recipe per
 *     item, `1..{@link MAX_IMPORT_ITEMS_PER_REQUEST}` items per request (a larger file is several `PUT`s; the 100 kB body
 *     limit answers an oversized chunk with `413`, and one recipe is capped so a single-item request always fits). There is
 *     NO per-file cap (owner ruling, second round): the ordinal's ceiling, {@link MAX_IMPORT_ITEMS}, is `int4`'s own.
 *  3. **The statement is four forms and nothing else** (ADR-0072 §9): "I wrote this" carries no citation; a public web page
 *     carries its URL; a book and a paid site carry a citation. The server derives the recipe's `sourceType` from it.
 *  4. **No food names are stored, so none are published from storage.** A name on the wire was resolved at read time, as
 *     the caller, by the same match view the paste screen uses ({@link parseProposalMatchSchema}).
 *  5. **A flag is derived, never stored** (`importFlagOf`), and `version` is a digest of what the view was built from,
 *     verdicts included: the client compares it with the last one it saw to learn whether anything changed.
 */
import { z } from 'zod';
import {
    boundBySchema,
    ingredientQuantitySchema,
    recipeStepInstructionSchema,
    recipeVisibilitySchema,
    MAX_PARSE_JOB_LINES,
    PARSE_JOB_LINE_MAX_CHARS,
} from '@kitchensink/recipe-core';

import { parseProposalMatchSchema } from './parseJobs.schema.js';
import { createRecipeRequestSchema, recipeStepInputSchema } from './recipes.schema.js';

// ── Bounds ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The most items one request may carry. The recipes are structured text and the JSON body limit is 100 kB, so a chunk of
 * this many can exceed the limit; that is a `413`, which the client answers by sending fewer items. It always has a
 * remedy, because ONE recipe always fits ({@link MAX_IMPORT_RECIPE_BYTES}).
 */
export const MAX_IMPORT_ITEMS_PER_REQUEST = 25;

/**
 * The most bytes one imported recipe may serialize to. Under the service's 100 kB JSON body limit with room for the
 * request envelope, so a request carrying a single recipe can never be a `413`: without this, one large recipe would be
 * impossible to send at any chunk size. Counted in BYTES of the JSON the client sends, because the limit is bytes and a
 * character count lets multi-byte text through at three times the size. Per-field character bounds still apply.
 */
export const MAX_IMPORT_RECIPE_BYTES = 90_000;

/**
 * One past the last item ordinal an import accepts: `int4`'s ceiling. There is NO product cap on file size (owner ruling:
 * a file of any size is accepted and the allowance paces it), so the only bound is the column. A hostile ordinal is a
 * `400` and never a Postgres `22003`. The cursor (`position == item count` means done) also fits `int4`.
 */
export const MAX_IMPORT_ITEMS = 2_147_483_647;

/** The most steps one imported recipe may carry. */
export const MAX_IMPORT_STEPS = 200;

/** The longest one step's instruction, in characters. Bounds the stored document; a longer one is rejected, never truncated. */
export const MAX_IMPORT_STEP_CHARS = 5_000;

/** The longest citation, in characters. Mirrors the `recipe_import_items` CHECK. */
export const IMPORT_MAX_CITATION_LENGTH = 2_000;

/** The most item rows one `GET` returns. */
export const MAX_IMPORT_PAGE_SIZE = 500;

/** An item's position in the file the client read: a non-negative `int4`, below {@link MAX_IMPORT_ITEMS}. */
const importOrdinalSchema = z
    .number()
    .int()
    .min(0)
    .max(MAX_IMPORT_ITEMS - 1);

/** A line or food index within one recipe: a non-negative integer bounded by the parse job's own line cap. */
const importLineIndexSchema = z
    .number()
    .int()
    .min(0)
    .max(MAX_PARSE_JOB_LINES - 1);

// ── The recipe an item carries ───────────────────────────────────────────────────────────────────

/** Whether a string has a visible character. A blank citation is a second spelling of "none". */
const hasText = (value: string): boolean => value.trim() !== '';

/** The size of a value as the JSON a client sends, in bytes. */
const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * One recipe as the client read it from the export file.
 *
 * The descriptive fields are the create-recipe ones, picked from {@link createRecipeRequestSchema}, so every character
 * limit and `int4` ceiling is the one the create route enforces. The ingredients are RAW LINES: the server parses and
 * matches them (the file does not bind a food), and a line is bounded like a paste's. Servings and the three times may be
 * absent, because another app's export often states none; the save fills what is absent.
 *
 * Its serialized size is bounded ({@link MAX_IMPORT_RECIPE_BYTES}), so any one recipe fits one request.
 *
 * ⛔ No `source`, `sourceType`, `sourceUrl` or `visibility` here: provenance comes from the per-recipe STATEMENT, and
 * visibility from the choices (ADR-0072 §9), so a recipe cannot assert either itself.
 */
export const importRecipeSchema = createRecipeRequestSchema
    .pick({
        title: true,
        description: true,
        cuisine: true,
        difficulty: true,
        mealType: true,
        servings: true,
        prepTimeMinutes: true,
        cookTimeMinutes: true,
        totalTimeMinutes: true,
        tags: true,
        dietaryFlags: true,
    })
    .partial({ servings: true, prepTimeMinutes: true, cookTimeMinutes: true, totalTimeMinutes: true })
    .extend({
        /** The ingredient lines as written, in order. Trimmed by the server; a blank line is refused, not dropped. */
        ingredientLines: z.array(z.string().min(1).max(PARSE_JOB_LINE_MAX_CHARS)).max(MAX_PARSE_JOB_LINES),
        steps: z
            .array(
                recipeStepInputSchema.extend({ instruction: recipeStepInstructionSchema.max(MAX_IMPORT_STEP_CHARS) }),
            )
            .max(MAX_IMPORT_STEPS),
    })
    .refine((recipe) => jsonBytes(recipe) <= MAX_IMPORT_RECIPE_BYTES, {
        message: `a recipe may be at most ${String(MAX_IMPORT_RECIPE_BYTES)} bytes as JSON`,
    });

/** One recipe as the client read it from the file. */
export type ImportRecipe = z.infer<typeof importRecipeSchema>;

/** One item of a request: the recipe and its place in the file. */
export const importItemInputSchema = z.strictObject({
    /** The recipe's position in the file. The client's identity for the item, stable across devices and retries. */
    ordinal: importOrdinalSchema,
    recipe: importRecipeSchema,
});

/** One item of a request. */
export type ImportItemInput = z.infer<typeof importItemInputSchema>;

/** `1..25` items with distinct ordinals: a request names each item once. */
const importItemsSchema = z
    .array(importItemInputSchema)
    .min(1)
    .max(MAX_IMPORT_ITEMS_PER_REQUEST)
    .refine((items) => new Set(items.map((item) => item.ordinal)).size === items.length, {
        message: 'two items in one request share an ordinal',
    });

// ── The vocabularies ─────────────────────────────────────────────────────────────────────────────

/**
 * How the import matches (ADR-0072 §7). `MATCH_MODES` in `import/domain/importBindingPolicy.ts` owns the same set;
 * `importSchemaParity.test.ts` and this file's test compare them.
 */
export const importMatchModeSchema = z.enum(['keepAsWritten', 'bindBest', 'review']);

/** One match mode. */
export type ImportMatchMode = z.infer<typeof importMatchModeSchema>;

/** Where an item stands. `ready` is not a stage: readiness is computed from the lines. */
export const importStageSchema = z.enum(['received', 'parsing', 'matched', 'saved']);

/** One stage. */
export type ImportStage = z.infer<typeof importStageSchema>;

/** The cook's mark on an item in the wizard. Mirrors `ITEM_REVIEWS`. */
export const importReviewMarkSchema = z.enum(['pending', 'reviewed', 'skipped']);

/** One mark. */
export type ImportReviewMark = z.infer<typeof importReviewMarkSchema>;

// ── The per-recipe statement (ADR-0072 §9) ───────────────────────────────────────────────────────

const citationTextSchema = z
    .string()
    .min(1)
    .max(IMPORT_MAX_CITATION_LENGTH)
    .refine(hasText, { message: 'citation is blank' });

/** A public web page's citation is its address, http(s) only: a `javascript:` or `file:` URL is not a source. */
const citationUrlSchema = z.url({ protocol: /^https?$/ }).max(IMPORT_MAX_CITATION_LENGTH);

const authoredStatement = z.object({ kind: z.literal('authored') });
const publicWebStatement = z.object({ kind: z.literal('public_web'), citation: citationUrlSchema });
const bookStatement = z.object({ kind: z.literal('book'), citation: citationTextSchema });
const paidSiteStatement = z.object({ kind: z.literal('paid_site'), citation: citationTextSchema });

/**
 * What the cook says about ONE recipe, as the REQUEST carries it. The server stores it as `statement_kind` (`authored` or
 * `source`) plus a source kind, and derives the recipe's `sourceType` from it: `authored` → `user_created`, `public_web` →
 * `imported_public`, `book` → `imported_physical`, `paid_site` → `imported_paid`.
 *
 * ⚠️ A DISCRIMINATED UNION of strict members, not an object with an optional `citation`: "I wrote this" with a citation, or
 * a source with none, would be a state the server then has to refuse, and a wire that cannot express it needs no refusal.
 * This is also the one place `imported_public` is declarable by an unprivileged caller (ADR-0023's exception, this route
 * only); the stored statement and citation are what back the label.
 *
 * ⛔ Counsel confirms the wording the cook sees before launch (016 FR-050). The WIRE shape does not depend on it.
 */
export const importStatementSchema = z.discriminatedUnion('kind', [
    authoredStatement.strict(),
    publicWebStatement.strict(),
    bookStatement.strict(),
    paidSiteStatement.strict(),
]);

/** One statement, as a request carries it. */
export type ImportStatement = z.infer<typeof importStatementSchema>;

/** The same four forms as a RESPONSE reads them: loose, so a newer server's field does not break an installed client. */
export const importStatementViewSchema = z.discriminatedUnion('kind', [
    authoredStatement,
    publicWebStatement,
    bookStatement,
    paidSiteStatement,
]);

/** One statement, as a response carries it. */
export type ImportStatementView = z.infer<typeof importStatementViewSchema>;

// ── Requests ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Body of `POST /api/v1/import`: the choices for the whole import and the first chunk of the file.
 *
 * `ownerId` is absent and unaccepted: the owner is the verified principal. The match mode and visibility are asked once
 * for the whole import; the wizard can change a recipe's visibility afterwards.
 */
export const createImportRequestSchema = z.strictObject({
    matchMode: importMatchModeSchema,
    /** Public or private for every recipe, unless one overrides it. The visibility policy decides what each label allows. */
    visibility: recipeVisibilitySchema,
    items: importItemsSchema,
});

/** Body of `POST /api/v1/import`. */
export type CreateImportRequest = z.infer<typeof createImportRequestSchema>;

/**
 * Body of `PUT /api/v1/import/{importId}/items`: more of the file, or a corrected recipe. Idempotent by ordinal — the same
 * request twice leaves one item — and refused with `IMPORT_ITEM_ALREADY_SAVED` for an item whose recipe was saved.
 */
export const putImportItemsRequestSchema = z.strictObject({ items: importItemsSchema });

/** Body of `PUT /api/v1/import/{importId}/items`. */
export type PutImportItemsRequest = z.infer<typeof putImportItemsRequestSchema>;

/** Body of `POST /api/v1/import/{importId}/advance`: nothing. The step is bounded by the server and runs as the caller. */
export const advanceImportRequestSchema = z.strictObject({});

/** Body of `POST /api/v1/import/{importId}/leave` ("Save and leave"): nothing. */
export const leaveImportRequestSchema = z.strictObject({});

/**
 * Body of `POST /api/v1/import/{importId}/cursor`: move the wizard.
 *
 * `from` is where the caller believes the cursor is (`null` when it is done). A cursor that is somewhere else because
 * another device moved it is `409 IMPORT_CURSOR_MOVED`, carrying where it is now, and nothing changes.
 */
export const importCursorRequestSchema = z.strictObject({
    /** Where the caller believes the cursor is: an item ordinal, or `null` when the wizard is done. */
    from: importOrdinalSchema.nullable(),
    move: z.discriminatedUnion('action', [
        /** Mark the current item reviewed and move on. */
        z.strictObject({ action: z.literal('next') }),
        /** Mark the current item skipped and move on. */
        z.strictObject({ action: z.literal('skip') }),
        /** Move back one item (from done, to the last). Marks nothing. */
        z.strictObject({ action: z.literal('back') }),
        /** Jump to an item. Marks nothing. */
        z.strictObject({ action: z.literal('open'), to: importOrdinalSchema }),
    ]),
});

/** Body of `POST /api/v1/import/{importId}/cursor`. */
export type ImportCursorRequest = z.infer<typeof importCursorRequestSchema>;

/**
 * Body of `PUT /api/v1/import/{importId}/items/{ordinal}/pick`: the cook's decision on ONE food of one line.
 *
 * The cook's decision always wins, including "keep this line as written" (ADR-0072 §7). `against` is the
 * `judgementDigest` of the line as the cook saw it; a pick made against a judgement that has since been recomputed no
 * longer applies. A food is named by id only — the server re-validates it when it saves, as it does for any bind.
 */
export const importPickRequestSchema = z.strictObject({
    lineIndex: importLineIndexSchema,
    foodIndex: importLineIndexSchema,
    against: z.string().min(1).max(255),
    pick: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('food'), id: z.string().min(1).max(255) }),
        z.strictObject({ kind: z.literal('variant'), id: z.string().min(1).max(255) }),
        z.strictObject({ kind: z.literal('asWritten') }),
    ]),
});

/** Body of `PUT …/items/{ordinal}/pick`. */
export type ImportPickRequest = z.infer<typeof importPickRequestSchema>;

/**
 * Body of `POST /api/v1/import/{importId}/items/{ordinal}`: the cook's choices on one item — what they say about the
 * recipe, and whether it is public or private. At least one; `visibility: null` clears the recipe's own choice so it
 * follows the import again.
 */
export const recordImportChoicesRequestSchema = z
    .strictObject({
        statement: importStatementSchema.optional(),
        visibility: recipeVisibilitySchema.nullable().optional(),
    })
    .refine((body) => body.statement !== undefined || body.visibility !== undefined, {
        message: 'send a statement, a visibility, or both',
    });

/** Body of `POST …/items/{ordinal}`. */
export type RecordImportChoicesRequest = z.infer<typeof recordImportChoicesRequestSchema>;

/** Query of `GET /api/v1/import/{importId}`: a page of items by ordinal. Strings on the wire, so parsed from them. */
export const getImportQuerySchema = z.object({
    /** Return items with an ordinal GREATER than this. Omit for the first page. */
    after: z.coerce.number().int().min(-1).max(MAX_IMPORT_ITEMS).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_IMPORT_PAGE_SIZE).optional(),
});

/** Query of `GET /api/v1/import/{importId}`. */
export type GetImportQuery = z.infer<typeof getImportQuerySchema>;

// ── Responses (loose) ────────────────────────────────────────────────────────────────────────────

/** A food by id and the name food gave it on this read. Names are never stored. */
const foodRefViewSchema = z.object({
    kind: z.enum(['root', 'variant']),
    id: z.string().min(1),
    name: z.string().min(1),
});

/** One item as the list shows it. */
export const importItemSummarySchema = z.object({
    ordinal: z.number().int().nonnegative(),
    title: z.string(),
    stage: importStageSchema,
    review: importReviewMarkSchema,
    /** What the cook said about the recipe, or `null` until they do. An item cannot be saved without one. */
    statement: importStatementViewSchema.nullable(),
    /** This recipe's own visibility choice, or `null` when it follows the import. */
    visibility: recipeVisibilitySchema.nullable(),
    /** The draft the item created, or `null` before the save (and after the cook deleted the draft). */
    recipeId: z.uuid().nullable(),
});

/** One item as the list shows it. */
export type ImportItemSummary = z.infer<typeof importItemSummarySchema>;

/**
 * The import: its choices, where the wizard is, and a page of items.
 *
 * `version` is a digest of what this view was built from, VERDICTS INCLUDED, computed at read time and never stored; the
 * client compares it with the last one to learn whether anything changed. `cursorOrdinal` is `null` when the wizard is done.
 */
export const importViewSchema = z.object({
    id: z.uuid(),
    matchMode: importMatchModeSchema,
    visibility: recipeVisibilitySchema,
    /** The item the wizard is on, or `null` when it is past the last. */
    cursorOrdinal: z.number().int().nonnegative().nullable(),
    /** Whether the cook ended the wizard with Save and leave. */
    reviewClosed: z.boolean(),
    version: z.string().min(1),
    counts: z.object({
        total: z.number().int().nonnegative(),
        received: z.number().int().nonnegative(),
        parsing: z.number().int().nonnegative(),
        matched: z.number().int().nonnegative(),
        saved: z.number().int().nonnegative(),
    }),
    items: z.array(importItemSummarySchema),
    /** The last ordinal on this page when more follow (pass it as `after`), else `null`. */
    nextAfter: z.number().int().nonnegative().nullable(),
});

/** The import as `GET /api/v1/import/{importId}` answers. */
export type ImportView = z.infer<typeof importViewSchema>;

/** The three flag states of a line the import bound without the cook in front of it. Derived, never stored. */
export const importFlagSchema = z.discriminatedUnion('state', [
    z.object({ state: z.literal('clear') }),
    z.object({ state: z.literal('checking') }),
    z.object({ state: z.literal('flagged'), suggestion: foodRefViewSchema.nullable() }),
]);

/** One flag. */
export type ImportFlag = z.infer<typeof importFlagSchema>;

/** The flags worth listing: a `clear` line is not in the review list. */
const importListedFlagSchema = z.discriminatedUnion('state', [
    z.object({ state: z.literal('checking') }),
    z.object({ state: z.literal('flagged'), suggestion: foodRefViewSchema.nullable() }),
]);

/** What the cook decided about one food of one line, as the step shows it. */
const importPickViewSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('food'), id: z.string().min(1) }),
    z.object({ kind: z.literal('variant'), id: z.string().min(1) }),
    z.object({ kind: z.literal('asWritten') }),
]);

/** One food of one line of one item, as the wizard step shows it. */
export const importStepLineSchema = z.object({
    lineIndex: z.number().int().nonnegative(),
    foodIndex: z.number().int().nonnegative(),
    /** The line as the file stated it. */
    sourceLine: z.string(),
    /** The ingredient phrase the parse lifted out of it. */
    phrase: z.string(),
    measure: z.object({ quantity: ingredientQuantitySchema, unit: z.string(), preparation: z.string().optional() }),
    /** Pass this back as `against` when picking. */
    judgementDigest: z.string().min(1),
    /** The paste screen's match view: the closed state, the proposal and the candidates, names resolved as the caller. */
    match: parseProposalMatchSchema,
    /** `null` for a line the import has not bound. */
    flag: importFlagSchema.nullable(),
    /** The cook's decision, or `null`. */
    pick: importPickViewSchema.nullable(),
    /** Who bound the line when it was saved (`ingredients.bound_by`), or `null` before the save and for a line kept as written. */
    boundBy: boundBySchema.nullable(),
});

/** One food of one line, as the step shows it. */
export type ImportStepLine = z.infer<typeof importStepLineSchema>;

/** One item with its match lines: what the wizard shows at the cursor. */
export const importStepResponseSchema = z.object({
    ordinal: z.number().int().nonnegative(),
    title: z.string(),
    stage: importStageSchema,
    review: importReviewMarkSchema,
    statement: importStatementViewSchema.nullable(),
    visibility: recipeVisibilitySchema.nullable(),
    lines: z.array(importStepLineSchema),
});

/** One item with its match lines. */
export type ImportStepResponse = z.infer<typeof importStepResponseSchema>;

/** One bound line the import wants the cook to look at. */
export const importFlaggedLineSchema = z.object({
    ordinal: z.number().int().nonnegative(),
    lineIndex: z.number().int().nonnegative(),
    foodIndex: z.number().int().nonnegative(),
    title: z.string(),
    sourceLine: z.string(),
    /** The food the line is bound to now. */
    bound: foodRefViewSchema,
    boundBy: boundBySchema,
    flag: importListedFlagSchema,
});

/** `GET /api/v1/import/{importId}/flagged`: the lines the import bound that the review gate did not agree with, or is still checking. */
export const importFlaggedResponseSchema = z.object({ lines: z.array(importFlaggedLineSchema) });

/** The flagged list. */
export type ImportFlaggedResponse = z.infer<typeof importFlaggedResponseSchema>;

/** One line saved as written that waits for the cook. */
export const importToCheckLineSchema = z.object({
    ordinal: z.number().int().nonnegative(),
    lineIndex: z.number().int().nonnegative(),
    foodIndex: z.number().int().nonnegative(),
    title: z.string(),
    sourceLine: z.string(),
    judgementDigest: z.string().min(1),
    /** The match view, so the cook can pick a food or keep the line as written. */
    match: parseProposalMatchSchema,
});

/**
 * `GET /api/v1/import/{importId}/to-check`: the lines saved as written because nothing may bind without the cook (the
 * spend ceiling was reached, ADR-0072 §10), until the cook picks a food or keeps them as written.
 */
export const importToCheckResponseSchema = z.object({ lines: z.array(importToCheckLineSchema) });

/** The to-check list. */
export type ImportToCheckResponse = z.infer<typeof importToCheckResponseSchema>;
