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
 * | Method   | Path                                                | Request                              | Answer           |
 * | -------- | --------------------------------------------------- | ------------------------------------ | ---------------- |
 * | `POST`   | `/api/v1/import`                                    | {@link createImportRequestSchema}    | `201` view       |
 * | `GET`    | `/api/v1/import`                                    | query: {@link importListQuerySchema} | `200` list of the caller's imports |
 * | `GET`    | `/api/v1/import/to-check-count`                     | —                                    | `200` library-wide count |
 * | `PUT`    | `/api/v1/import/{importId}/items`                   | {@link putImportItemsRequestSchema}  | `200` view / `409 IMPORT_ITEM_LOCKED` / `409 IMPORT_ITEM_ALREADY_SAVED` |
 * | `GET`    | `/api/v1/import/{importId}`                         | query: `after`, `limit`              | `200` view       |
 * | `DELETE` | `/api/v1/import/{importId}`                         | —                                    | `204` (saved recipes stay) |
 * | `POST`   | `/api/v1/import/{importId}/advance`                 | {@link advanceImportRequestSchema}   | `200` view (ALWAYS, the allowance state is in it) |
 * | `GET`    | `/api/v1/import/{importId}/steps/{ordinal}`         | —                                    | `200` step       |
 * | `POST`   | `/api/v1/import/{importId}/cursor`                  | {@link importCursorRequestSchema}    | `200` view / `409 IMPORT_CURSOR_MOVED` |
 * | `PUT`    | `/api/v1/import/{importId}/items/{ordinal}/pick`    | {@link importPickRequestSchema}      | `200` pick       |
 * | `POST`   | `/api/v1/import/{importId}/items/{ordinal}`         | {@link recordImportChoicesRequestSchema} | `200` step / `409 IMPORT_ITEM_ALREADY_SAVED` |
 * | `POST`   | `/api/v1/import/{importId}/choices`                 | {@link recordImportChoicesBatchRequestSchema} | `200` view / `409 IMPORT_ITEM_ALREADY_SAVED` |
 * | `POST`   | `/api/v1/import/{importId}/leave`                   | {@link leaveImportRequestSchema}     | `200` view       |
 * | `GET`    | `/api/v1/import/{importId}/flagged`                 | query: {@link importListQuerySchema} | `200` flagged    |
 * | `GET`    | `/api/v1/import/{importId}/to-check`                | query: {@link importListQuerySchema} | `200` to-check   |
 *
 * ⚠️ `to-check-count` is a literal word, never a UUID, so it cannot shadow `{importId}` (ADR-0072 §1).
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
    recipeCuisineSchema,
    recipeIngredientDisplayTextSchema,
    recipeIngredientNoteSchema,
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

/**
 * The most items one batch of choices names. “Make the rest public” is one list and one confirm (owner ruling
 * 2026-10-26), and a free cook out of slots can hold hundreds of items, so it is a batch rather than one request per
 * recipe. A recipe-free body, so the 100 kB limit is no constraint at this size.
 */
export const MAX_IMPORT_CHOICES_PER_REQUEST = 100;

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

/** Whether a string has a visible character. A blank citation is a second spelling of "none". */
const hasText = (value: string): boolean => value.trim() !== '';

/**
 * The size of a value as JSON, in bytes. It measures the PARSED value, which can differ from the bytes the client sent (key
 * order, defaults); {@link MAX_IMPORT_RECIPE_BYTES} leaves about 12 kB of the 100 kB body limit for that and the envelope.
 */
const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

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

/** The statement kinds this contract knows, as the request schema spells them. */
const KNOWN_STATEMENT_KINDS: readonly string[] = importStatementSchema.options.map((option) => option.shape.kind.value);

/**
 * A statement whose kind this client does not know: a newer server's kind ("adapted" and "family" wait on the owner).
 *
 * ⛔ Its OWN arm, never `null` (that reads "Needs your statement", and a client that then saved would write an older kind
 * over the newer one) and never a bare `{ kind: string }` (which breaks narrowing for every consumer). A client shows it as
 * a statement it cannot edit and never sends it back: the request schema stays closed.
 */
const unrecognisedStatement = z
    .object({ kind: z.literal('unrecognised') })
    .describe(
        'Client-side only: what a client reads for a statement kind newer than it knows. The server never sends it.',
    );

/** Whether a value is a statement whose kind is a string this contract does not know. Pure. */
const hasUnknownKind = (value: unknown): boolean =>
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof value.kind === 'string' &&
    !KNOWN_STATEMENT_KINDS.includes(value.kind);

/**
 * The same four forms as a RESPONSE reads them: loose, so a newer server's field does not break an installed client.
 *
 * ⚠️ The statement kind is the ONE open vocabulary on the way out (lead ruling 2026-11-11), so a new kind is an
 * expand-first union change with the server deployed first. Only an UNKNOWN kind reads as `unrecognised`: a broken KNOWN
 * statement (a `public_web` with a `javascript:` citation) still fails, so a server bug is not swallowed. The stage and
 * review vocabularies stay closed. A preprocess, not a transform, because the contract fingerprint describes the OUTPUT
 * side and records a transform as unrepresentable.
 */
export const importStatementViewSchema = z.preprocess(
    (value) => (hasUnknownKind(value) ? { kind: 'unrecognised' } : value),
    z.discriminatedUnion('kind', [
        authoredStatement,
        publicWebStatement,
        bookStatement,
        paidSiteStatement,
        unrecognisedStatement,
    ]),
);

/** One statement, as a response carries it. */
export type ImportStatementView = z.infer<typeof importStatementViewSchema>;

// ── The recipe an item carries ───────────────────────────────────────────────────────────────────

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
        /**
         * The ingredient lines as written, in order. A blank line is refused, not dropped. The server stores the raw line
         * UNTRIMMED as the source's statement of the line, and trims only the copy it parses.
         */
        ingredientLines: z
            .array(z.string().min(1).max(PARSE_JOB_LINE_MAX_CHARS).refine(hasText, { message: 'line is blank' }))
            .max(MAX_PARSE_JOB_LINES),
        steps: z
            .array(
                recipeStepInputSchema.extend({ instruction: recipeStepInstructionSchema.max(MAX_IMPORT_STEP_CHARS) }),
            )
            .max(MAX_IMPORT_STEPS),
    })
    // The item table keeps the title beside the payload and refuses a blank one (`btrim(title) <> ''`); a title of spaces
    // passes the create bound (`min(1)`), so it is refused here rather than as a database error on a request the client sent.
    .refine((recipe) => hasText(recipe.title), { message: 'title is blank', path: ['title'] })
    .refine((recipe) => jsonBytes(recipe) <= MAX_IMPORT_RECIPE_BYTES, {
        message: `a recipe may be at most ${String(MAX_IMPORT_RECIPE_BYTES)} bytes as JSON`,
    });

/** One recipe as the client read it from the file. */
export type ImportRecipe = z.infer<typeof importRecipeSchema>;

/**
 * One item of a request: the recipe and its place in the file, and optionally what the cook already said about it.
 *
 * `statement` and `visibility` ride here so a file whose recipes were all stated at the start needs no round trip per
 * recipe (an item cannot be saved without a statement). Merge rule on a replay: ABSENT keeps what the item holds,
 * PRESENT replaces it.
 */
export const importItemInputSchema = z.strictObject({
    /** The recipe's position in the file. The client's identity for the item, stable across devices and retries. */
    ordinal: importOrdinalSchema,
    recipe: importRecipeSchema,
    statement: importStatementSchema.optional(),
    /** This recipe's own visibility, overriding the import's. */
    visibility: recipeVisibilitySchema.optional(),
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

// ── Requests ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Body of `POST /api/v1/import`: the choices for the whole import and the first chunk of the file.
 *
 * `ownerId` is absent and unaccepted: the owner is the verified principal. The match mode and visibility are asked once
 * for the whole import; the wizard can change a recipe's visibility afterwards.
 *
 * ⚠️ THE CLIENT MINTS THE ID (a UUID; the repo's local-first convention), so a lost `201` is safe to replay: the same id
 * with the same body answers the same import, the same id with a different body is a `409`, and an id some other cook
 * holds is answered as not found. Without it a retry would create a second import of the same file.
 *
 * `expectedTotal` is how many recipes the whole file holds. Chunks arrive over many requests, and the wizard's cursor is
 * "done" only when it reaches this, not when it reaches the last recipe that has arrived. Every item's ordinal is below it.
 */
export const createImportRequestSchema = z
    .strictObject({
        id: z.uuid(),
        expectedTotal: z.number().int().min(1).max(MAX_IMPORT_ITEMS),
        matchMode: importMatchModeSchema,
        /** Public or private for every recipe, unless one overrides it. The visibility policy decides what each label allows. */
        visibility: recipeVisibilitySchema,
        items: importItemsSchema,
    })
    .refine((body) => body.items.every((item) => item.ordinal < body.expectedTotal), {
        message: 'an item ordinal is at or past expectedTotal',
    });

/** Body of `POST /api/v1/import`. */
export type CreateImportRequest = z.infer<typeof createImportRequestSchema>;

/**
 * Body of `PUT /api/v1/import/{importId}/items`: more of the file, or a corrected recipe.
 *
 * Keyed by ordinal, so a replay is safe. An item identical to the one held is a no-op. A DIFFERENT recipe replaces the held
 * one only while the item is still `received`; once it has a parse job, a paid unit or a snapshot the held recipe is what
 * those were made from, and the item is refused. A saved item is `409 IMPORT_ITEM_ALREADY_SAVED`. Two devices that send
 * different recipes for one ordinal therefore cannot orphan a parse. (The code for the not-yet-saved refusal is the
 * service lane's to name.) `statement` and `visibility` follow the merge rule on {@link importItemInputSchema}.
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
 * `from` is where the caller believes the cursor is (`null` when it is done: the position has reached `expectedTotal`).
 * Ordinals are contiguous `0..expectedTotal-1`. A cursor that is somewhere else because another device moved it is
 * `409 IMPORT_CURSOR_MOVED`, carrying where it is now, and nothing changes. `next` and `skip` mark the current item, so
 * they need one: from done they are refused here.
 */
export const importCursorRequestSchema = z
    .strictObject({
        /** Where the caller believes the cursor is: an item ordinal, or `null` when the wizard is done. */
        from: importOrdinalSchema.nullable(),
        move: z.discriminatedUnion('action', [
            /** Mark the current item reviewed and move on. Needs a current item. */
            z.strictObject({ action: z.literal('next') }),
            /** Mark the current item skipped and move on. Needs a current item. */
            z.strictObject({ action: z.literal('skip') }),
            /** Move back one item (from done, to the last). Marks nothing. */
            z.strictObject({ action: z.literal('back') }),
            /** Jump to an item. Marks nothing. */
            z.strictObject({ action: z.literal('open'), to: importOrdinalSchema }),
        ]),
    })
    .refine((body) => body.from !== null || (body.move.action !== 'next' && body.move.action !== 'skip'), {
        message: 'there is no current item to mark: the wizard is done',
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

/** Whether a choices body says anything: a statement, a visibility or a cuisine. */
const saysSomething = (body: { statement?: unknown; visibility?: unknown; cuisine?: unknown }): boolean =>
    body.statement !== undefined || body.visibility !== undefined || body.cuisine !== undefined;

/**
 * Body of `POST /api/v1/import/{importId}/items/{ordinal}`: the cook's choices on one item — what they say about the
 * recipe, whether it is public or private, and its cuisine. At least one; `visibility: null` clears the recipe's own choice
 * so it follows the import again.
 *
 * `cuisine` exists because the import saves every recipe PUBLISHED (ADR-0072 §3) and Publish needs one: a file that states
 * none holds the item under "Needs a cuisine" until the cook gives it (ADR-0072 §3 as amended 2026-11-11). It replaces the
 * file's cuisine for this recipe. Nothing picks one for the cook.
 */
export const recordImportChoicesRequestSchema = z
    .strictObject({
        statement: importStatementSchema.optional(),
        visibility: recipeVisibilitySchema.nullable().optional(),
        cuisine: recipeCuisineSchema.optional(),
    })
    .refine(saysSomething, { message: 'send a statement, a visibility, a cuisine, or several' });

/** Body of `POST …/items/{ordinal}`. */
export type RecordImportChoicesRequest = z.infer<typeof recordImportChoicesRequestSchema>;

/**
 * Body of `POST /api/v1/import/{importId}/choices`: the same choices for several items at once, each item carrying its OWN
 * statement (a statement is per recipe; one for a whole file is not the attestation 004 FR-014a asks for). Each entry
 * carries at least one of a statement, a visibility and a cuisine, and an ordinal appears once.
 */
export const recordImportChoicesBatchRequestSchema = z.strictObject({
    items: z
        .array(
            z
                .strictObject({
                    ordinal: importOrdinalSchema,
                    statement: importStatementSchema.optional(),
                    visibility: recipeVisibilitySchema.nullable().optional(),
                    cuisine: recipeCuisineSchema.optional(),
                })
                .refine(saysSomething, { message: 'send a statement, a visibility, a cuisine, or several' }),
        )
        .min(1)
        .max(MAX_IMPORT_CHOICES_PER_REQUEST)
        .refine((entries) => new Set(entries.map((entry) => entry.ordinal)).size === entries.length, {
            message: 'two entries in one request share an ordinal',
        }),
});

/** Body of `POST …/choices`. */
export type RecordImportChoicesBatchRequest = z.infer<typeof recordImportChoicesBatchRequestSchema>;

/** A non-negative integer spelled in digits. `''`, `' '`, `-1`, `1.5` and `1e3` are NOT numbers here, and `''` is not `0`. */
const digitsSchema = z.string().regex(/^\d{1,10}$/u);

/** A page size, in digits, from 1 to {@link MAX_IMPORT_PAGE_SIZE}. */
const pageSizeSchema = digitsSchema.transform(Number).pipe(z.number().int().min(1).max(MAX_IMPORT_PAGE_SIZE));

/** Query of `GET /api/v1/import/{importId}`: a page of items by ordinal. Strings on the wire, so parsed from them. */
export const getImportQuerySchema = z.object({
    /** Return items with an ordinal GREATER than this. Omit for the first page. */
    after: digitsSchema.transform(Number).pipe(importOrdinalSchema).optional(),
    limit: pageSizeSchema.optional(),
});

/** Query of `GET /api/v1/import/{importId}`. */
export type GetImportQuery = z.infer<typeof getImportQuerySchema>;

/**
 * Query of `GET …/flagged` and `GET …/to-check`: a page of lines. A 1,000-recipe import can hold thousands, so both are
 * paged from the start (a list that gains paging after clients assume it is whole breaks them). `after` is the opaque
 * `nextAfter` of the previous page.
 */
export const importListQuerySchema = z.object({
    after: z.string().min(1).max(200).optional(),
    limit: pageSizeSchema.optional(),
});

/** Query of the two line lists. */
export type ImportListQuery = z.infer<typeof importListQuerySchema>;

// ── Responses (loose) ────────────────────────────────────────────────────────────────────────────

/**
 * A food by id and the name food gave it on this read. Names are never stored (ADR-0045), so when food could not be asked
 * the name is `null`: the contract has no place for a name taken from storage.
 */
const foodRefViewSchema = z.object({
    kind: z.enum(['root', 'variant']),
    id: z.string().min(1),
    name: z.string().min(1).nullable(),
});

/** How many of an import's items stand at each stage; `total` is how many have ARRIVED. */
const importCountsSchema = z.object({
    total: z.number().int().nonnegative(),
    received: z.number().int().nonnegative(),
    parsing: z.number().int().nonnegative(),
    matched: z.number().int().nonnegative(),
    saved: z.number().int().nonnegative(),
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
    /**
     * Why the item cannot be saved yet, as an opaque key the clients localize (`visibilityRefused`, `waitingForAllowance`,
     * `needsCuisine` and the other publish requirements, a pick the server rejected, a review that is stuck), or `null`. The stage enum is closed and parsed strictly, so a
     * new stuck state arrives as a new key here and never as a new stage.
     */
    issue: z.object({ reason: z.string().min(1) }).nullable(),
});

/** One item as the list shows it. */
export type ImportItemSummary = z.infer<typeof importItemSummarySchema>;

/**
 * The import: its choices, where the wizard is, and a page of items.
 *
 * `version` is a digest of what this view was built from, VERDICTS INCLUDED, computed at read time and never stored; the
 * client compares it with the last one to learn whether anything changed. It covers the WHOLE import, not the page that
 * was asked for, so two pages of one moment carry one version. `cursorOrdinal` is `null` when the wizard is done, that is,
 * when it has reached `expectedTotal`.
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
    /** How many recipes the whole file holds. `counts.total` is how many have ARRIVED. */
    expectedTotal: z.number().int().positive(),
    /**
     * The caller's bulk allowance now: what it is, how much of it the last day spent, and when the next unit frees (an ISO
     * instant), or `null` when nothing is spent. A paused import explains itself from this.
     *
     * ⛔ AN `advance` THAT REACHES THE ALLOWANCE ANSWERS `200`, NOT `429` (ADR-0072 §8 as amended). It does the work it can
     * still pay for and returns this view, so the client keeps the progress it paid for and reads `used >= limit` with
     * `resetsAt` to explain the pause. A `429` would discard that progress at the client.
     */
    allowance: z.object({
        limit: z.number().int().nonnegative(),
        used: z.number().int().nonnegative(),
        resetsAt: z.iso.datetime().nullable(),
    }),
    /**
     * Why the whole import is paused, as an opaque key the clients localize, or `null` while it runs. Today the one key is
     * `outOfSlots`: a free cook's 50 private slots are used (ADR-0073 §8), so no more private recipe is saved until the cook
     * chooses to stop, or to make the rest public. DERIVED at read time from the live slot count and never stored. The
     * allowance's own pause is NOT here: it reads from `allowance`. A new key is an additive value, never a new field.
     */
    pause: z.object({ reason: z.string().min(1) }).nullable(),
    counts: importCountsSchema,
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
    /** The ingredient phrase the parse lifted out of it: what the match was asked. */
    phrase: z.string(),
    /**
     * The row the import saves, as the editor saves a pasted row (recipe-core's `pastedLineRowOf`): `name` is the food's
     * name with a leading size word moved into the unit, and a line kept as written is saved under it; `displayText` is the
     * cook's words when the parse chose them as the shown name; `note` is a dimension in parentheses, never the unit (owner
     * ruling 2026-11-08). The wizard shows the line as it will be saved, so it never reads "3 large large eggs".
     */
    name: z.string().regex(/\S/u),
    displayText: recipeIngredientDisplayTextSchema.optional(),
    note: recipeIngredientNoteSchema.optional(),
    measure: z.object({ quantity: ingredientQuantitySchema, unit: z.string(), preparation: z.string().optional() }),
    /** Pass this back as `against` when picking. */
    judgementDigest: z.string().min(1),
    /**
     * The paste screen's match view: the closed state, the proposal and the candidates, names resolved as the caller. `null`
     * when food could not be asked on this read: the contract has no place for a name taken from storage (ADR-0045), so the
     * line shows no match and the client asks again.
     */
    match: parseProposalMatchSchema.nullable(),
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
    /** The cuisine the save will use: the cook's choice, else the file's, else `null` (the item then needs one). */
    cuisine: z.string().min(1).nullable(),
    lines: z.array(importStepLineSchema),
});

/** One item with its match lines. */
export type ImportStepResponse = z.infer<typeof importStepResponseSchema>;

/**
 * Answer to `PUT …/pick`. `applied` is `false` when the pick was made against a judgement that has since been recomputed
 * (so it no longer applies), and `step` is then the FRESH step to choose again from. A stale pick is neither an error nor
 * silent.
 */
export const importPickResponseSchema = z.object({ applied: z.boolean(), step: importStepResponseSchema });

/** Answer to `PUT …/pick`. */
export type ImportPickResponse = z.infer<typeof importPickResponseSchema>;

/** One bound line the import wants the cook to look at. */
export const importFlaggedLineSchema = z.object({
    ordinal: z.number().int().nonnegative(),
    lineIndex: z.number().int().nonnegative(),
    foodIndex: z.number().int().nonnegative(),
    title: z.string(),
    sourceLine: z.string(),
    /** The draft that holds the line, or `null` when the cook deleted it. */
    recipeId: z.uuid().nullable(),
    /** The food the line is bound to now. */
    bound: foodRefViewSchema,
    boundBy: boundBySchema,
    flag: importListedFlagSchema,
    /** Pass this back as `against` to pick another food. */
    judgementDigest: z.string().min(1),
    /** The paste screen's match view, so the cook sees the candidates without opening the step. `null` when food was down. */
    match: parseProposalMatchSchema.nullable(),
});

/** `GET /api/v1/import/{importId}/flagged`: the lines the import bound that the review gate did not agree with, or is still checking. */
export const importFlaggedResponseSchema = z.object({
    lines: z.array(importFlaggedLineSchema),
    /** Pass as `after` for the next page, or `null` on the last. */
    nextAfter: z.string().min(1).nullable(),
});

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
    /** The match view, so the cook can pick a food or keep the line as written. `null` when food was down on this read. */
    match: parseProposalMatchSchema.nullable(),
});

/**
 * `GET /api/v1/import/{importId}/to-check`: the lines saved as written because nothing may bind without the cook (the
 * spend ceiling was reached, ADR-0072 §10), until the cook picks a food or keeps them as written.
 */
export const importToCheckResponseSchema = z.object({
    lines: z.array(importToCheckLineSchema),
    /** Pass as `after` for the next page, or `null` on the last. */
    nextAfter: z.string().min(1).nullable(),
});

/** The to-check list. */
export type ImportToCheckResponse = z.infer<typeof importToCheckResponseSchema>;

/** One import as the list shows it: enough for a second device to find it and resume. */
export const importSummarySchema = z.object({
    id: z.uuid(),
    matchMode: importMatchModeSchema,
    visibility: recipeVisibilitySchema,
    expectedTotal: z.number().int().positive(),
    counts: importCountsSchema,
    createdAt: z.iso.datetime(),
    /** The last time the cook or a step wrote to the import. The working data is purged 30 days after it (ADR-0072 §12). */
    updatedAt: z.iso.datetime(),
});

/** One import in the list. */
export type ImportSummary = z.infer<typeof importSummarySchema>;

/**
 * `GET /api/v1/import`: the caller's imports, newest first, paged by the opaque `nextAfter` of the previous page. A cook who
 * signs in on a second device finds the import here and resumes it.
 */
export const importListResponseSchema = z.object({
    imports: z.array(importSummarySchema),
    /** Pass as `after` for the next page, or `null` on the last. */
    nextAfter: z.string().min(1).nullable(),
});

/** The list of the caller's imports. */
export type ImportListResponse = z.infer<typeof importListResponseSchema>;

/**
 * `GET /api/v1/import/to-check-count`: how many lines, across every import the caller still holds, were saved as written and
 * wait for the cook to pick a food or keep them (the “{count} to check” at the top of My recipes). A line leaves the count
 * when the cook picks or keeps it, or edits it into a food in the editor; it also leaves when its import's working data is
 * purged (ADR-0072 §12).
 */
export const importToCheckCountResponseSchema = z.object({ count: z.number().int().nonnegative() });

/** The library-wide to-check count. */
export type ImportToCheckCountResponse = z.infer<typeof importToCheckCountResponseSchema>;
