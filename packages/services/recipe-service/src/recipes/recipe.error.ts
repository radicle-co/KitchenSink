/**
 * `RecipeDomainError` — the concrete throwable for recipe-domain failures.
 *
 * It is a real `Error` subclass (so stacks/logging work) that ALSO satisfies the structural
 * {@link RecipeError} contract from `@kitchensink/recipe-core` (`{ code, message, details? }`). The
 * global `ApiExceptionFilter` recognizes it via `isRecipeError` and maps `code` → HTTP status +
 * `{ code, message, details? }` envelope, so throwing this class is all a service/DAL needs to do.
 */
import { HttpException } from '@nestjs/common';
import {
    RecipeErrorCode,
    type ImportLockedStage,
    type PrivateFoodLine,
    type PublishRequirement,
    type RecipeError,
    type VersionConflictSide,
} from '@kitchensink/recipe-core';

import { apiError } from '../common/apiError.js';

/** A thrown recipe-domain error carrying a machine-readable {@link RecipeErrorCode}. */
export class RecipeDomainError extends Error implements RecipeError {
    /** The machine-readable domain error code (drives the HTTP-status mapping). */
    public readonly code: RecipeErrorCode;

    /** Optional structured payload surfaced under the response `details` key. */
    public readonly details?: Record<string, unknown>;

    public constructor(code: RecipeErrorCode, message: string, details?: Record<string, unknown>) {
        super(message);
        this.name = 'RecipeDomainError';
        this.code = code;

        if (details !== undefined) {
            this.details = details;
        }

        // Restore the prototype chain (transpilation to ES targets breaks `instanceof` otherwise).
        Object.setPrototypeOf(this, RecipeDomainError.prototype);
    }
}

/** Type guard for {@link RecipeDomainError} instances. */
export function isRecipeDomainError(value: unknown): value is RecipeDomainError {
    return value instanceof RecipeDomainError;
}

/** `RECIPE_NOT_FOUND` — no active recipe with that id (or it is soft-deleted). */
export function recipeNotFound(id: string): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.RECIPE_NOT_FOUND, `Recipe ${id} not found.`);
}

/**
 * `VERSION_LINE_UNRESTORABLE` (→ 409) — plan 002 R52: a version restore would drop the lines at these snapshot
 * positions, because their bindings are gone and they froze no name.
 *
 * @param positions - The 0-based snapshot positions.
 * @returns The error.
 */
export function versionLineUnrestorable(positions: readonly number[]): RecipeDomainError {
    return new RecipeDomainError(
        RecipeErrorCode.VERSION_LINE_UNRESTORABLE,
        'This version cannot be restored: some of its ingredients no longer exist and have no name to find them by.',
        { positions: [...positions] },
    );
}

/**
 * `RECIPE_NOT_FOUND` (→ 404) reused for a missing catalog ingredient — the ingredient picker surfaces
 * "not found" through the same code the filter already maps, rather than a bare error object.
 */
export function ingredientNotFound(id: string): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.RECIPE_NOT_FOUND, `Ingredient '${id}' not found`);
}

/**
 * `UNKNOWN_INGREDIENT` (→ 400) — Stage 2: the picked food-catalog hit cannot back an ingredient row.
 *
 * Raised by `POST /api/v1/ingredients/by-food` when the referenced food has no usable golden record: it is
 * unknown/terminal to the food service, still mid-resolution (`PENDING`/`UNRESOLVED`), or resolved but
 * nameless. A single code covers all three deliberately — from the caller's side they are one fact ("this
 * food id is not admissible as an ingredient right now"), and collapsing them avoids confirming whether a
 * given opaque food id exists in the food catalog.
 *
 * A 400 rather than a 404 because the honest failure is the REQUEST (a stale or hand-crafted `foodId`), not a
 * missing recipe-service resource — and the caller's remedy is a different action (`by-name` or freeform),
 * not a retry. `details.foodId` carries the id back for diagnosis.
 */
export function foodNotAdmissible(foodId: string, reason: string): RecipeDomainError {
    return new RecipeDomainError(
        RecipeErrorCode.UNKNOWN_INGREDIENT,
        `Food '${foodId}' cannot back an ingredient: ${reason}.`,
        { foodId },
    );
}

/**
 * `PRIVATE_FOODS_ON_PUBLIC_RECIPE` (→ 400) — the write would leave a recipe published and public while a line is bound to
 * a food its author keeps private (`domain/publicFoodsPolicy.ts`, ADR-0029 section 4). `details.lines` names every such
 * line, so a client marks each and offers "Open food".
 *
 * @param lines - Every refused line (at least one), by position and food.
 * @returns The error.
 */
export function privateFoodsOnPublicRecipe(lines: readonly [PrivateFoodLine, ...PrivateFoodLine[]]): RecipeDomainError {
    return new RecipeDomainError(
        RecipeErrorCode.PRIVATE_FOODS_ON_PUBLIC_RECIPE,
        'A public recipe cannot use a food only its author can see. Make the food public, or keep the recipe private.',
        { lines: lines.map((line) => ({ sortOrder: line.sortOrder, foodId: line.foodId })) },
    );
}

/**
 * `PUBLISH_REQUIREMENTS_UNMET` (→ 400) — the write would leave the recipe published without something Publish needs
 * (`domain/publishPolicy.ts`). `details.missing` names every gap, so a client shows its own localized copy for each.
 *
 * @param reason - The policy's own refusal text (`PublishDecision.reason`), so the sentence is written once.
 * @param missing - Every unmet requirement, in page order (at least one).
 * @returns The error.
 */
export function publishRequirementsUnmet(
    reason: string,
    missing: readonly [PublishRequirement, ...PublishRequirement[]],
): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.PUBLISH_REQUIREMENTS_UNMET, reason, { missing: [...missing] });
}

/**
 * `IMPORT_QUOTA_EXCEEDED` (→ 429) — the caller's daily import allowance is spent (004 FR-022). `details.resetsAt` is the
 * instant it reopens for them, as an ISO string, and is the ONLY detail: the count and the limit are not on the wire.
 *
 * @param resetsAt - When the next unit of the caller's allowance on that channel becomes available (the oldest counted unit leaves the window).
 * @returns The error.
 */
export function importQuotaExceeded(resetsAt: Date): RecipeDomainError {
    return new RecipeDomainError(
        RecipeErrorCode.IMPORT_QUOTA_EXCEEDED,
        'The daily import allowance is spent. It reopens at the time in details.resetsAt.',
        { resetsAt: resetsAt.toISOString() },
    );
}

/**
 * `IMPORT_NOT_FOUND` (→ 404) — no bulk import with that id belongs to the caller (ADR-0072).
 *
 * ONE answer for a stranger's import and a missing one: a 403 would confirm another cook's import id exists.
 *
 * @param id - The import id the caller asked for.
 * @returns The error.
 */
export function importNotFound(id: string): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.IMPORT_NOT_FOUND, `Import '${id}' not found`);
}

/**
 * `IMPORT_CURSOR_MOVED` (→ 409) — the wizard's cursor is not where the caller said it was (ADR-0072): another device
 * moved it. `details.cursorOrdinal` is where it is now, so the caller can resync without a second read.
 *
 * @param cursorOrdinal - The item the cursor is on now, or `null` when it is past the last item.
 * @returns The error.
 */
export function importCursorMoved(cursorOrdinal: number | null): RecipeDomainError {
    return new RecipeDomainError(
        RecipeErrorCode.IMPORT_CURSOR_MOVED,
        'The import has moved on from where this request expected it to be.',
        { cursorOrdinal },
    );
}

/**
 * `IMPORT_ITEM_ALREADY_SAVED` (→ 409) — the item's recipe was already saved (ADR-0072 §2/§3). An item is saved once, so
 * a request that would change it after the save is refused, and a client that retried a save learns the first landed.
 *
 * @param ordinal - The item that is already saved.
 * @returns The error.
 */
export function importItemAlreadySaved(ordinal: number): RecipeDomainError {
    return new RecipeDomainError(
        RecipeErrorCode.IMPORT_ITEM_ALREADY_SAVED,
        `Import item ${String(ordinal)} has already been saved.`,
        { ordinal },
    );
}

/**
 * `IMPORT_ITEM_LOCKED` (→ 409) — a different recipe was sent for an item that is past `received` (ADR-0072 §3). The recipe
 * the item holds is what its paid parse and its match snapshot were made from.
 *
 * @param ordinal - The item.
 * @param stage - Where it stands: `parsing` or `matched` (a saved item is {@link importItemAlreadySaved}).
 * @returns The error.
 */
export function importItemLocked(ordinal: number, stage: ImportLockedStage): RecipeDomainError {
    return new RecipeDomainError(
        RecipeErrorCode.IMPORT_ITEM_LOCKED,
        `Import item ${String(ordinal)} is already being processed and its recipe cannot be replaced.`,
        { ordinal, stage },
    );
}

/**
 * `IMPORT_ID_IN_USE` (→ 409) — the client-minted import id is already the caller's import with different choices
 * (ADR-0072 §1). A replay of the same body is not this: it answers the same import.
 *
 * @returns The error.
 */
export function importIdInUse(): RecipeDomainError {
    return new RecipeDomainError(
        RecipeErrorCode.IMPORT_ID_IN_USE,
        'An import with this id already exists with different choices.',
    );
}

/** `NOT_OWNER` — the authenticated principal does not own the recipe. */
export function notOwner(id: string): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.NOT_OWNER, `Recipe ${id} is not owned by the caller.`);
}

/**
 * `UNKNOWN_INGREDIENT` — a recipe ingredient line references an `ingredientId` that has no row in the
 * shared ingredients catalog. The client must resolve ingredients (via `/api/v1/ingredients`) before
 * attaching them to a recipe; this fails the write fast with a 400 instead of a raw FK 500.
 */
export function unknownIngredient(ingredientId: string): RecipeDomainError {
    return new RecipeDomainError(
        RecipeErrorCode.UNKNOWN_INGREDIENT,
        `Ingredient ${ingredientId} does not exist in the catalog.`,
        { ingredientId },
    );
}

/**
 * `CANNOT_RATE_OWN_RECIPE` (→ 403) — the caller tried to rate a recipe they own (FR-013). A 403 is
 * correct and leaks nothing here: the owner already knows their own recipe exists. This is deliberately
 * distinct from the IDOR case — rating a recipe the caller CANNOT see is a 404 `RECIPE_NOT_FOUND`
 * ({@link recipeNotFound}), so an unreadable recipe is indistinguishable from a missing one.
 */
export function cannotRateOwnRecipe(id: string): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.CANNOT_RATE_OWN_RECIPE, `Recipe ${id} cannot be rated by its owner.`);
}

/**
 * `VERSION_CONFLICT` — the client's `expectedVersion` no longer matches the stored `currentVersion`
 * (optimistic-concurrency loss, T033). `details` always carries both version numbers; when `sides` is
 * supplied (W8-a.5, the owner-gated update path) it additionally carries the `server` (current winning)
 * snapshot and, when still retained, the `base` snapshot — read coherently — so the conflict UI can
 * 3-way merge without a second round-trip. `currentVersion` is the concurrency token the resolve echoes.
 */
export function versionConflict(
    currentVersion: number,
    conflictingVersion: number,
    sides?: { server: VersionConflictSide; base?: VersionConflictSide },
): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.VERSION_CONFLICT, 'Recipe version conflict', {
        currentVersion,
        conflictingVersion,
        ...(sides !== undefined
            ? { server: sides.server, ...(sides.base !== undefined ? { base: sides.base } : {}) }
            : {}),
    });
}

/**
 * `INVALID_VISIBILITY` — the requested visibility transition is denied by the C-004 policy (T048 / T050),
 * e.g. a free-tier user making a recipe private, or making an imported physical/paid recipe public. The
 * evaluator's deny-`reason` becomes the message; `details` carries the attempted visibility + source type.
 * Reuses the shared code already mapped to 400 by `ApiExceptionFilter`.
 */
export function invalidVisibility(reason: string, details?: Record<string, unknown>): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.INVALID_VISIBILITY, reason, details);
}

/**
 * `FORBIDDEN` — the caller declared a provenance it is not granted to declare (004-FR-025, ADR-0023).
 *
 * ⚠️ A `403` and not a `400`, because the refusal is about the CALLER rather than the body: the same bytes
 * from a curator are accepted. A `400` would tell an ordinary user their request was malformed, which is
 * false and would send them to fix a payload that is already correct.
 *
 * ⚠️ It returns an `HttpException` rather than a {@link RecipeDomainError}, and that is the shape the
 * shipped contract already chose. `FORBIDDEN` is a PUBLISHED code in `apiError.schema.ts` — documented there
 * as "Authenticated, but not permitted (a scope/permission gate rather than an ownership one)", which is
 * this case verbatim — but it is deliberately NOT a member of `recipe-core`'s `RecipeErrorCode`, because it
 * is not a recipe-DOMAIN outcome. Adding a member to that enum to reach it would widen a union both apps
 * consume, for a denial `details.requiredScope` already makes actionable.
 *
 * @param reason - The policy's deny-reason, surfaced as the error message.
 * @param details - Machine-readable context; carries `requiredScope` so a client can say what is missing.
 * @returns The exception to throw.
 */
export function provenanceNotPermitted(reason: string, details?: Record<string, unknown>): HttpException {
    return apiError('FORBIDDEN', reason, details);
}

/** `details.reason` of the `FORBIDDEN` a locked source answers with: the stable key a client branches on (ADR-0089). */
const SOURCE_LOCKED_REASON = 'SOURCE_LOCKED';

/**
 * `FORBIDDEN` with `details.reason: 'SOURCE_LOCKED'` (→ 403) — a `PATCH` tried to change the source of a recipe that was
 * first published (or whose source the cook did not state), so it can no longer change (ADR-0089, ADR-0058).
 *
 * ⚠️ A 403 and NOT a 409, and not a new published code. An installed client reads an unknown 409 as a version conflict (the
 * same reason `PRIVATE_SLOTS_FULL` is a 403), and a new member of `recipeErrorCodeSchema` would widen a contract both apps
 * consume for a refusal the editor already prevents (it shows no field once `firstPublishedAt` is present). `FORBIDDEN` is
 * "authenticated, but not permitted", which is this case; `details.reason` is the stable key.
 *
 * @returns The exception to throw.
 */
export function sourceLocked(): HttpException {
    return provenanceNotPermitted('The source of a recipe cannot be changed after it was first published.', {
        reason: SOURCE_LOCKED_REASON,
    });
}

/**
 * `VALIDATION_FAILED` (→ 400) — a create body carried both the curator's `source` and the cook's `statement`. They are two
 * ways of saying where a recipe came from, so a body naming both has said two things. It is answered here, not by a
 * refinement on the create schema, because a refined object cannot be picked from (`importRecipeSchema` picks from it).
 *
 * @returns The exception to throw.
 */
export function sourceAndStatementTogether(): HttpException {
    return apiError('VALIDATION_FAILED', 'Send either source or statement, not both.', {
        fields: ['statement: cannot be sent together with source'],
    });
}

/**
 * `VALIDATION_FAILED` (→ 400) — a statement's link is not a usable web source. The wire schema refuses it first; this is the
 * answer for the policy's own refusal, so the policy stays total without a path that returns a 500.
 *
 * @param reason - The policy's deny-reason.
 * @returns The exception to throw.
 */
export function sourceNotUsable(reason: string): HttpException {
    return apiError('VALIDATION_FAILED', reason, { fields: [`statement.citation: ${reason}`] });
}

/**
 * `PRIVATE_SLOTS_FULL` (→ 403) - a free cook has no private slot left (ADR-0073). NOTHING was written.
 *
 * `used` is the live count the write saw under the per-user lock; it can exceed `limit` for a cook who lost Premium with
 * more than the limit, and is reported as it is.
 *
 * @param used - The cook's private, undeleted recipes.
 * @param limit - The cook's limit.
 * @returns The error.
 */
export function privateSlotsFull(used: number, limit: number): RecipeDomainError {
    return new RecipeDomainError(RecipeErrorCode.PRIVATE_SLOTS_FULL, 'All of your private slots are in use.', {
        used,
        limit,
    });
}
