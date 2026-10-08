/**
 * T025 / T033 — recipe CRUD orchestration + authorization.
 *
 * Sits between the controller (which supplies the authenticated owner key — `principal.userId`) and the
 * {@link RecipesDal}. It owns the domain rules the DAL deliberately does not:
 * - **Authorization** — mutations are owner-only (`owner_id == principal.userId` → else `NOT_OWNER`);
 *   a read is allowed for the owner OR any `public` recipe.
 * - **Optimistic concurrency (T033)** — an update whose `expectedVersion` != the stored
 *   `currentVersion` is rejected with `VERSION_CONFLICT` (409, `details.currentVersion`).
 * - **Response shaping** — persistence rows → the `Recipe` wire contract (ISO dates, `version`).
 *
 * Ownership is ALWAYS the app-user ULID, never the Clerk `sub` (D2 / REQ-IF-007).
 */
import * as Sentry from '@sentry/nestjs';
import { createHash } from 'node:crypto';
import { BadRequestException, forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { deriveDisplayName } from '@kitchensink/identity-core';
import { quantitiesEqual, type RecipeSnapshot, type VersionConflictSide } from '@kitchensink/recipe-core';
import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';
import { PROVISIONAL_VERIFICATION_THRESHOLDS } from '@kitchensink/recipe-core/resolution/verification-gate-policy';
import { bandKeyText } from '@kitchensink/recipe-core/resolution/band-authority-store';
import { shadowRateFor } from '@kitchensink/recipe-core/resolution/band-policy';
import { RecipeSourceType, RecipeStatus, RecipeVisibility } from '@kitchensink/recipe-core';

import { toPageEnvelope } from '../common/pagination.js';
import { VersionsService } from '../versions/versions.service.js';
import { RecipesDal, type RecipeAggregate, type StepInput } from './dal/recipes.dal.js';
import { RatingsDal } from '../ratings/dal/ratings.dal.js';
import type { IngredientLineInput } from './dal/ingredientLines.dal.js';
import { quantityFromColumns, statedMeasureFromColumns } from './dal/quantityColumns.js';
import { userNutritionFromColumns } from './dal/userNutritionColumns.js';
import {
    invalidVisibility,
    notOwner,
    provenanceNotPermitted,
    recipeNotFound,
    versionConflict,
} from './recipe.error.js';
import { evaluateProvenance } from './domain/provenancePolicy.js';
import { defaultCloneVisibility, evaluateVisibility } from './domain/visibilityPolicy.js';
import { isContained, type ContainmentSubject } from '../common/containmentPolicy.js';
import { assertNotContained, testPrincipalContained } from '../common/containment.error.js';
import { isRecipeViewableBy } from './domain/recipeVisibility.js';
import { recordsVersion } from './domain/versionPolicy.js';
import { toRecipeSummaryResponse } from './mappers/recipeResponse.js';
import { resolveCdnUrl } from '../photos/photoView.js';
import type { CreateRecipeDto, CreateRecipeStepInputDto, RecipeIngredientInputDto } from './dto/createRecipe.dto.js';
import { carryForwardTranscription } from './domain/transcriptionCarryForward.js';
import {
    buildVerificationRequests,
    type VerifiableLine,
    bandKeyOf,
    type BandConsultation,
} from './domain/verificationRequests.js';
import { IngredientResolutionsDal } from '../ingredients/resolution/ingredientResolutions.dal.js';
import type { LatestResolution } from '../ingredients/resolution/ingredientResolutions.dal.js';
import { ResolutionBandsDal } from '../ingredients/resolution/resolutionBands.dal.js';
import { VerificationRedriveDal } from '../ingredients/resolution/verificationRedrive.dal.js';
import { VERIFICATION_QUEUE, type VerificationQueuePort } from './verification.queue.js';
import type { UpdateRecipeDto } from './dto/updateRecipe.dto.js';
import type { ListRecipesQueryDto } from './dto/listRecipes.query.dto.js';
import type { PaginatedRecipesResponse, RecipeResponse } from './dto/recipeResponse.dto.js';
import {
    isUserEnteredOf,
    shareableLineNameOf,
    shareableVariantPartsOf,
    type IngredientLineIdentity,
} from '../ingredients/domain/ingredientLineIdentity.js';
import { LineIdentityReader } from '../ingredients/lineIdentity.reader.js';
import { foodRefOf, isStrangerToPrivateFood, privateFoodOwnerOf } from '../database/schema/foodLookupArm.js';
import type { IngredientRow, RecipeRow, RecipeStepRow } from '../database/schema/index.js';
import type { RecipeTx } from '../database/unitOfWork.js';
import type { Principal } from '../auth/principal.js';
import type { CallerToken } from '../auth/CallerToken.js';
import type { NutritionReadBudget } from '../ingredients/foodNutrition.gateway.js';
import { RECIPES_DAL, RECIPES_SHADOW_RNG, RECIPE_PHOTOS_CDN_URL, RECIPE_RATINGS_DAL } from './recipes.tokens.js';
import { RecipeDetailAssembler } from './recipeDetail.assembler.js';
import { IngredientLinePlanner } from './ingredientLine.planner.js';
import { ingredientNamesText } from './domain/ingredientNamesText.js';
import { verificationFoodNameOf } from './domain/lineVerification.js';

/** Identities by lookup id, as the planner or the identity reader derived them. */
type LineIdentities = ReadonlyMap<string, IngredientLineIdentity>;

/**
 * Project a PERSISTED line onto the gate's question.
 *
 * ⛔ THE ONLY PROJECTION, used for the lines being asked about AND for the lines already asked about. The
 * DTO carries an unrounded `number` while `ingredients.quantity` is `numeric(10,3)`, so a projection of the
 * request would key a verdict on a quantity no row holds. Reading the RETURNED rows removes the question.
 *
 * ⚠️ `quantityFromColumns` is the ONE adapter that turns the two nullable `numeric` columns back into the value
 * object — the same one the read projection and `ingredientsChanged` use.
 *
 * ⛔ The food comes from `foodRefOf(arm)` — the bound root or variant (curated U9) — the one derivation the detail
 * read's verdict lookup also uses. A line with NO NAME has no catalog identity here: the gate asks whether the source line means a
 * named food, and cannot be asked about a food this save could not name (food unreachable at save). For a line
 * already asked about, a missing identity means no suppression — the SAFE direction (re-ask). A previous
 * line can only share a judgement with a current line through the same binding (one binding per food), so
 * the current plan's identities cover every previous line that could match.
 *
 * @param row - The stored line.
 * @param identities - The lines' identities, by lookup id.
 * @param resolutions - The latest resolution events, by lookup id.
 * @returns The verifiable projection. Pure.
 */
function storedLineToVerifiable(
    row: IngredientRow,
    identities: LineIdentities,
    resolutions: ReadonlyMap<string, LatestResolution>,
): VerifiableLine {
    const identity = identities.get(row.foodLookupId);
    const name = identity?.name;

    return {
        sourceLine: row.sourceLine ?? undefined,
        // Migration 0041 — the parsed phrase, the memo tier's key grain. Absent for authored lines.
        sourcePhrase: row.sourcePhrase ?? undefined,
        // The food the line is BOUND to — a root or a variant — keyed exactly as the detail read looks a verdict up.
        food: identity === undefined || name === undefined ? undefined : foodRefOf(identity.arm),
        // The food's name as food shows it, never the caller's phrase: the gate asks whether the source line
        // means THIS food, and our rendering is the output of the very parse under test. A variant names its parts.
        candidateFoodName: identity === undefined ? '' : (verificationFoodNameOf(identity) ?? ''),
        quantity: quantityFromColumns(row),
        unit: row.unit,
        // ⛔ U7/U11 — what the SOURCE printed, when the pair above is a RESTATEMENT of it. Through the ONE
        // adapter, and never omitted: a projection that dropped it would key the resulting verdict the pre-0027
        // way, so the corrected line could never find it.
        statedMeasure: statedMeasureFromColumns(row),
        // U2/U4: the latest recorded resolution EVENT for this line's binding — absence maps to `unattributed`.
        resolution: resolutions.get(row.foodLookupId),
        // U11 (0040): whether this line's food is someone's PRIVATE authored one. Rides to the worker as the
        // message's `privateFood` — no memo write, no band observation for a food only its author sees. The owner
        // is on the binding, so this can no longer fail to be read.
        privateFood: identity !== undefined && privateFoodOwnerOf(identity.arm) !== undefined,
    };
}

/**
 * The permission string that marks a principal as premium-tier. There is deliberately NO tier field on
 * the {@link Principal} (subscriptions are a future feature, 010), so premium is derived from the signed
 * session token's `permissions` claim: `isPremium = principal.permissions.includes(PREMIUM_PERMISSION)`.
 * Centralized here so the C-004 policy has a single tier source until 010 introduces real subscriptions.
 */
export const PREMIUM_PERMISSION = 'premium';

/** Map a DTO step to the DAL's step input shape. Pure. */
function toStepInput(step: { instruction: string; timerSeconds?: number }): StepInput {
    return step.timerSeconds === undefined
        ? { instruction: step.instruction }
        : { instruction: step.instruction, timerSeconds: step.timerSeconds };
}

/**
 * Map a persisted line to the line a clone persists: the same binding and every fact about the line. Pure.
 *
 * ⛔ The clone keeps the BINDING, including one to another author's private food (plan 002 R9, AE10). Copying
 * that food's name into a new declared line, as this mapper once did, published a private name to the cloner.
 * The kept binding renders as unavailable to them instead, and they may rebind it.
 */
function toClonedLineInput(row: IngredientRow): IngredientLineInput {
    const stated = statedMeasureFromColumns(row);

    return {
        foodLookupId: row.foodLookupId,
        // Both quantity columns, read through the ONE adapter (`dal/quantityColumns.ts`).
        quantity: quantityFromColumns(row),
        unit: row.unit,
        ...(row.displayText !== null ? { displayText: row.displayText } : {}),
        // U26/U27 — facts about THIS LINE that the cloner is copying wholesale.
        ...(row.preparation !== null ? { preparation: row.preparation } : {}),
        ...(row.groupLabel !== null ? { groupLabel: row.groupLabel } : {}),
        // ⛔ The transcription travels with the clone (U11): it is a fact about the SOURCE, and the judgement is
        // content-identical to the source's only if the source line, the phrase and the stated measure all travel,
        // because `verificationKey` hashes them. The clone does NOT enqueue a verification of its own.
        ...(row.sourceLine !== null ? { sourceLine: row.sourceLine } : {}),
        ...(row.sourcePhrase !== null ? { sourcePhrase: row.sourcePhrase } : {}),
        ...(stated === undefined ? {} : { statedMeasure: stated }),
        sortOrder: row.sortOrder,
        // Preserve any per-line user-entered nutrition (FR-007a) across a clone.
        ...userNutritionFromColumns(row),
    };
}

/**
 * How many of a recipe's lines are bound to a food this viewer may not see: another author's private food.
 *
 * @param rows - The lines.
 * @param identities - Their identities, by lookup id.
 * @param viewerId - The viewer.
 * @returns The count. Pure.
 */
function countHiddenFromViewer(rows: readonly IngredientRow[], identities: LineIdentities, viewerId: string): number {
    return rows.filter((row) => {
        const arm = identities.get(row.foodLookupId)?.arm;

        return isStrangerToPrivateFood(arm === undefined ? undefined : privateFoodOwnerOf(arm), viewerId);
    }).length;
}

/** Map a persisted step row to the DAL's step input shape (for cloning). Pure. */
function toStepInputFromRow(row: RecipeStepRow): StepInput {
    return row.timerSeconds === null
        ? { instruction: row.instruction }
        : { instruction: row.instruction, timerSeconds: row.timerSeconds };
}

/**
 * Capture a persisted recipe aggregate as an immutable {@link RecipeSnapshot} for version history
 * (FR-007b). The snapshot must be faithful enough to RESTORE the recipe, so it carries the full content
 * (title/description/servings/times + ordered steps + lines with the binding and any user-nutrition
 * override), keyed at the recipe's current version. Pure.
 *
 * ⛔ Each line's frozen name is {@link shareableLineNameOf}: a version is readable by every reader of the recipe,
 * so a private food's name is never frozen into one, even by its author (plan 002 R9, AE10). A line whose
 * identity was not derived freezes no name; a restore then follows its binding (R52).
 *
 * @param aggregate - The recipe as persisted.
 * @param identities - The lines' identities, by lookup id.
 */
function aggregateToSnapshot(aggregate: RecipeAggregate, identities: LineIdentities): RecipeSnapshot {
    const { recipe, steps, ingredients } = aggregate;

    return {
        version: recipe.currentVersion,
        title: recipe.title,
        description: recipe.description ?? '',
        servings: recipe.servings,
        prepTimeMinutes: recipe.prepTimeMinutes,
        cookTimeMinutes: recipe.cookTimeMinutes,
        steps: steps.map((step) => ({
            id: step.id,
            recipeId: step.recipeId,
            stepNumber: step.stepNumber,
            instruction: step.instruction,
            ...(step.timerSeconds !== null ? { timerSeconds: step.timerSeconds } : {}),
        })),
        ingredients: ingredients.map((line) => {
            const identity = identities.get(line.foodLookupId);
            const name = identity === undefined ? undefined : shareableLineNameOf(identity);
            const variantParts = identity === undefined ? undefined : shareableVariantPartsOf(identity);

            return {
                id: line.id,
                recipeId: line.recipeId,
                // The binding, under the snapshot's continuous field name.
                ingredientId: line.foodLookupId,
                // Both quantity columns, read through the ONE adapter (`dal/quantityColumns.ts`).
                quantity: quantityFromColumns(line),
                unit: line.unit,
                ...(line.displayText !== null ? { displayText: line.displayText } : {}),
                // U26/U27 — in the SNAPSHOT, so a restore can put them back.
                ...(line.preparation !== null ? { preparation: line.preparation } : {}),
                ...(line.groupLabel !== null ? { groupLabel: line.groupLabel } : {}),
                sortOrder: line.sortOrder,
                ...(name !== undefined ? { ingredientName: name } : {}),
                // Curated U9: history, like the name — a restore follows the binding, never these parts.
                ...(variantParts !== undefined ? { variantParts: [...variantParts] } : {}),
                isUserEntered: identity !== undefined && isUserEnteredOf(identity),
                ...userNutritionFromColumns(line),
            };
        }),
    };
}

/** Whether an incoming step patch differs from the persisted steps (order-sensitive). Pure. */
function stepsChanged(existing: RecipeStepRow[], incoming: CreateRecipeStepInputDto[]): boolean {
    if (existing.length !== incoming.length) {
        return true;
    }

    return existing.some((step, index) => {
        const next = incoming[index];

        return (
            next === undefined ||
            step.instruction !== next.instruction ||
            (step.timerSeconds ?? null) !== (next.timerSeconds ?? null)
        );
    });
}

/** Whether an incoming ingredient patch differs from the persisted links (order-sensitive). Pure. */
function ingredientsChanged(existing: IngredientRow[], incoming: RecipeIngredientInputDto[]): boolean {
    if (existing.length !== incoming.length) {
        return true;
    }

    return existing.some((row, index) => {
        const next = incoming[index];

        return (
            next === undefined ||
            row.foodLookupId !== next.ingredientId ||
            // ⛔ `!==` here would be REFERENCE identity against a value object — every metadata-only PATCH
            // would read as a substantive edit and mint a new version. `quantitiesEqual` is the value
            // object's own identity, and it is what makes an upper-bound-only edit substantive (C-004).
            !quantitiesEqual(quantityFromColumns(row), next.quantity) ||
            (row.unit.length > 0 ? row.unit : '') !== (next.unit ?? '') ||
            (row.displayText ?? null) !== (next.notes ?? null) ||
            // ⛔ U26/U27 — this function is a POSITIVE field-by-field enumeration (see the note above), so a
            // line field left out here is invisible to it and nothing fails to compile. Left out, an edit
            // that changes ONLY how the onion is chopped, or which section the line sits in, is saved with
            // `hasSubstantiveEdit: false`: no version is minted, the previous value is unrecoverable, and
            // C-004 never re-judges visibility for a recipe whose content moved.
            //
            // ⚠️ `?? null` on BOTH sides is load-bearing: the row spells absent as `null` and the wire spells
            // it by omitting the key, so a bare `!==` would read `undefined !== null` and mint a version on
            // every metadata-only PATCH.
            (row.preparation ?? null) !== (next.preparation ?? null) ||
            (row.groupLabel ?? null) !== (next.groupLabel ?? null)
        );
    });
}

/**
 * Whether an update is a *substantive* edit (C-004 / FR-005): a change to INGREDIENTS or STEPS. A patch
 * touching only metadata (title/description/tags/cuisine/times/servings/dietaryFlags) is NOT substantive.
 * Pure — compares the incoming patch against the existing aggregate.
 */
function detectSubstantiveEdit(existing: RecipeAggregate, dto: UpdateRecipeDto): boolean {
    if (dto.steps !== undefined && stepsChanged(existing.steps, dto.steps)) {
        return true;
    }

    if (dto.ingredients !== undefined && ingredientsChanged(existing.ingredients, dto.ingredients)) {
        return true;
    }

    return false;
}

/**
 * What a write states about the version it records.
 *
 * Replaces `recordSnapshot?: boolean`. A boolean could only say "do not record one", which is an opt-out
 * of an invariant; a directive says what the version MEANS, and every write has one.
 */
export interface SnapshotDirective {
    /** The change summary stored on the version row. Defaults to `'Updated'`. */
    readonly changeSummary?: string;
    /** The version this write was restored FROM, when it was a restore. */
    readonly baseVersion?: number;
}

/** What {@link RecipesService.getById} reads. */
export interface GetRecipeRequest {
    /** The user viewing the recipe — its owner, or anyone for a `public` recipe. */
    readonly viewerId: string;
    /** The recipe's id. */
    readonly id: string;
    /** The caller's token, forwarded to the food service for nutrition; absent for an internal re-read. */
    readonly caller: CallerToken | undefined;
    /** How long the nutrition read may take. */
    readonly budget: NutritionReadBudget;
}

@Injectable()
export class RecipesService {
    public constructor(
        @Inject(RECIPES_DAL) private readonly dal: RecipesDal,
        // Plan 002 U4 — a write's lines are planned (bindings loaded, names read) OUTSIDE the transaction.
        private readonly planner: IngredientLinePlanner,
        // The one reader of a stored line's name: clone, the version conflict and a line-less update use it.
        private readonly identities: LineIdentityReader,
        // Circular by nature: recipe writes record a version, and version restore drives a recipe write.
        // forwardRef lets Nest resolve the two-way dependency (see VersionsService's matching forwardRef).
        //
        // The field is typed as a `Pick` of VersionsService, NOT the concrete class, ON PURPOSE — DO NOT
        // "simplify" it back to `: VersionsService`. With `emitDecoratorMetadata`, the constructor param's
        // TYPE ANNOTATION is emitted into `design:paramtypes`, which is evaluated at class-definition time.
        // A concrete-class annotation there emits a VALUE reference to VersionsService; under native ESM the
        // recipes<->versions import cycle means that binding is still in its temporal dead zone when this
        // module first evaluates, so the compiled service crashes at boot with `ReferenceError: Cannot
        // access 'VersionsService' before initialization` (it only surfaces in the COMPILED image — tsx/
        // vitest transpile the cycle differently, so tests don't catch it). A `Pick<…>` is a structural
        // type with no runtime value, so `design:paramtypes` emits `Object` and the cycle boots — while
        // `forwardRef(() => VersionsService)` (lazy arrow, evaluated later) still resolves the real instance.
        @Inject(forwardRef(() => VersionsService)) private readonly versions: Pick<VersionsService, 'createSnapshot'>,
        @Inject(RECIPE_PHOTOS_CDN_URL) private readonly photosCdnUrl: string,
        // Own RatingsDal instance over the shared Drizzle client, used ONLY to read the viewer's own rating
        // for `RecipeDetail.viewerRating` (see RECIPE_RATINGS_DAL for why an own instance, not a module import).
        @Inject(RECIPE_RATINGS_DAL) private readonly ratingsDal: RatingsDal,
        // ⛔ THE VERIFICATION GATE'S PRODUCER (plan U11 / ADR-0024). REQUIRED, not defaulted: U11 shipped the
        // gate's consumer with nothing sending it a message, and a collaborator that defaults to a no-op is
        // how that state comes back — silently, past a green suite. Every construction site must name it.
        @Inject(VERIFICATION_QUEUE) private readonly verificationQueue: VerificationQueuePort,
        // U2 — REQUIRED, for the reason the verification queue above is: production has always supplied it,
        // and an optional collaborator is how a feature goes silently absent past a green suite. A fixture
        // that does not care passes a double; it may not omit it.
        private readonly ingredientResolutions: IngredientResolutionsDal,
        // U4 — required for the same reason.
        // ⚠️ A VALUE import, not a type-only one: this class is registered by reflection, so the param type
        // must be a runtime class Nest can resolve (a type-only import emits `Object` into
        // design:paramtypes and the app fails to BOOT — observed, not theorized).
        private readonly resolutionBands: ResolutionBandsDal,
        // U4c — required like its siblings.
        private readonly verificationRedrive: VerificationRedriveDal,
        // U-DA — the READ-side collaborator (`recipeDetail.assembler.ts`). Every detail projection that needs
        // the food service lives there, behind three public methods; this class keeps the orchestration and
        // the writes. ⛔ Call it only AFTER a transaction has committed: no signature there accepts a `RecipeTx`, so
        // it cannot USE one — but nothing stops a caller awaiting it inside a transaction callback, so ADR-0034's
        // "never hold a transaction across a network call" is still a rule each call site keeps.
        private readonly detailAssembler: RecipeDetailAssembler,
        // LAST, and the only optional one left: injected so the shadow coin is testable, with production
        // falling back to Math.random — the coin needs no cryptographic strength, only an unbiased rate.
        // ⚠️ Token-injected: a bare `() => number` param emits `Function` into design:paramtypes, which
        // Nest cannot resolve.
        @Optional() @Inject(RECIPES_SHADOW_RNG) private readonly rng?: () => number,
    ) {}

    /** One logger for the producer — a queue that is refusing work must be visible, never silent. */
    private readonly logger = new Logger(RecipesService.name);

    /*
     * ⛔ `leadCaloriesFor` DELETED (plan U10). It computed the headline per-serving calories at WRITE time
     * so the list/search projections could render them without an N+1 — i.e. it maintained the
     * denormalized column. With that column dropped there is nothing to maintain: the detail read derives
     * the figure from the same computation it already performs, and list/search honestly report nutrition
     * as unaccounted rather than serving a value frozen at the recipe's last save.
     *
     * Its OUTPUT field outlived it by a release and has now gone too (ADR-0021's "Follow-up owed"): the
     * detail response no longer echoes `nutrition.calories` back as a top-level `leadCaloriesPerServing`,
     * and a card's figure comes from `POST /api/v1/recipes/nutrition-batch`.
     */

    /**
     * Record an immutable version snapshot of a just-written recipe aggregate (FR-007b), in the SAME
     * transaction as the recipe write. This is the ONE place create/update/clone/restore converge to
     * populate version history.
     *
     * ⛔ NO try/catch, and the throw IS the mechanism (owner ruling 2026-09-06). This used to swallow, on
     * the reasoning that "the recipe has already committed, so a snapshot failure must NOT fail the
     * user's save" — which was true, and was the problem: a recipe saved with a silent hole in its
     * history, reported to the client as 201. The stated backstop ("the reconciliation/worker path
     * backstops a missed row") did not exist: `archiveSweeper.ts` selects FROM the outbox, so it can only
     * re-drive a row that is already there, and nothing anywhere reconstructs a missing version row.
     *
     * ⚠️ Un-swallowing ALONE would have made it worse. The recipe is written before this runs, so a bare
     * throw returns 5xx over a COMMITTED recipe — the same lie in the other direction. Atomicity is what
     * makes the reported outcome true, which is why the transaction is a required parameter and comes
     * first: a call site that forgot it does not typecheck.
     *
     * ⛔ A NEVER-PUBLISHED DRAFT RECORDS NONE (ADR-0058, amending ADR-0034). That is decided HERE, from the row the
     * write returned, by {@link recordsVersion} — never by a caller. `currentVersion` still moved, because it is the
     * compare-and-swap token between devices; only the history row is skipped, and with it the retention pass, which
     * has nothing new to judge.
     *
     * @param tx - The open transaction carrying the recipe write.
     * @sideEffect Inserts a `recipe_versions` row and records retention overflow, inside `tx`, unless the recipe has
     *   never been published.
     */
    private async recordSnapshotIn(
        tx: RecipeTx,
        aggregate: RecipeAggregate,
        identities: LineIdentities,
        ownerId: string,
        changeSummary: string,
        editorHandle?: string,
        baseVersion?: number,
    ): Promise<void> {
        if (!recordsVersion(aggregate.recipe)) {
            return;
        }

        await this.versions.createSnapshot(
            {
                recipeId: aggregate.recipe.id,
                versionNumber: aggregate.recipe.currentVersion,
                snapshot: aggregateToSnapshot(aggregate, identities),
                createdBy: ownerId,
                changeSummary,
                // Editor handle (W8-a.2) — the version editor's denormalized display name; omitted → NULL.
                ...(editorHandle !== undefined ? { editorHandle } : {}),
                // The version this write was restored FROM, when it was a restore. Absent otherwise.
                ...(baseVersion !== undefined ? { baseVersion } : {}),
            },
            tx,
        );
    }

    /**
     * Create a recipe owned by `principal.userId`.
     *
     * ⚠️ A create is no longer ALWAYS `user_created` (004-FR-024 / ADR-0023). It carries the provenance the
     * caller DECLARED, resolved by {@link evaluateProvenance} — which defaults an absent declaration to
     * `user_created`, so a body that says nothing behaves exactly as it always did, and gates
     * `imported_public` on the curator grant. A create still carries no substantive edit yet, and the
     * requested visibility is gated by the same pure C-004 {@link evaluateVisibility} policy the
     * set-visibility endpoint uses — now against the RESOLVED provenance: a free-tier caller requesting
     * `private` is rejected with `INVALID_VISIBILITY` (FR-003 — free-tier user_created recipes are
     * public-only), rather than silently persisting a `private` row the policy forbids. Premium is
     * derived from the signed token's `permissions` (see {@link PREMIUM_PERMISSION}).
     */
    public async create(
        principal: Principal,
        dto: CreateRecipeDto,
        caller: CallerToken | undefined,
    ): Promise<RecipeResponse> {
        // ── Provenance FIRST, then visibility ────────────────────────────────────────────────────
        // The order is the seam (ADR-0023): the provenance policy decides WHAT THE RECIPE IS, and C-004
        // then decides what visibility THAT THING may hold. Until 004-FR-024, `evaluateVisibility` was
        // handed the literal `USER_CREATED`, so the provenance a caller declared and the provenance its
        // visibility was judged against could not be the same fact.
        //
        // `scopes` ∪ `permissions` mirrors identity's `ScopesGuard` rule that a grant is satisfied by
        // EITHER list; both come from the token's SIGNED `public_metadata`.
        const provenanceDecision = evaluateProvenance({
            declared: dto.source,
            grantedScopes: [...principal.scopes, ...principal.permissions],
        });

        if (!provenanceDecision.allowed) {
            throw provenanceNotPermitted(provenanceDecision.reason, {
                requiredScope: provenanceDecision.requiredScope,
                sourceType: dto.source?.sourceType,
            });
        }

        const provenance = provenanceDecision.provenance;
        const requested = dto.visibility ?? RecipeVisibility.PUBLIC;
        const decision = evaluateVisibility({
            principalKind: principal.principalKind,
            containment: principal.containment,
            sourceType: provenance.sourceType,
            isPremium: principal.permissions.includes(PREMIUM_PERMISSION),
            hasSubstantiveEdit: false,
            requested,
        });

        if (!decision.allowed) {
            // ADR-0040: a contained test principal's publish is a 403 of its own, never a 400 C-004 refusal.
            throw decision.denial === 'contained'
                ? testPrincipalContained(decision.reason)
                : invalidVisibility(decision.reason, { visibility: requested, sourceType: provenance.sourceType });
        }

        // OUTSIDE the transaction: the plan reads the bindings and asks food for their names.
        const plan = await this.planner.plan(caller, dto.ingredients);
        // Denormalized author handle (W8-a.2 / decision 6): the initial value from the token claims via the
        // ONE shared rule. The handle-sync consumer keeps every owned recipe/version current thereafter.
        const authorHandle = deriveDisplayName(principal) || undefined;

        // ⛔ ONE TRANSACTION: the recipe and its version row commit together or not at all (owner ruling
        // 2026-09-06). Everything above stays OUTSIDE — reads, policy and pure derivation — and so does
        // everything below, because a Postgres transaction must never be held across a network call.
        const aggregate = await this.dal.transaction(async (tx) => {
            const created = await this.dal.create(
                {
                    ownerId: principal.userId,
                    title: dto.title,
                    description: dto.description,
                    cuisine: dto.cuisine,
                    visibility: requested,
                    servings: dto.servings,
                    prepTimeMinutes: dto.prepTimeMinutes,
                    cookTimeMinutes: dto.cookTimeMinutes,
                    totalTimeMinutes: dto.totalTimeMinutes,
                    // Author-stated difficulty (FR-001b) — persisted only when the author stated one; omitted
                    // otherwise so the row stays "not stated" (NULL). Never defaulted.
                    ...(dto.difficulty !== undefined ? { difficulty: dto.difficulty } : {}),
                    // Meal type (plan U34) — same rule as difficulty directly above: persisted only when the author
                    // stated one, omitted otherwise so the column stays NULL rather than acquiring a guessed value.
                    ...(dto.mealType !== undefined ? { mealType: dto.mealType } : {}),
                    // Publication status (W8-a.3) — omitted → DB default 'published'; Save-Draft sends 'draft'.
                    ...(dto.status !== undefined ? { status: dto.status } : {}),
                    tags: dto.tags ?? [],
                    dietaryFlags: dto.dietaryFlags ?? [],
                    // Provenance as the policy RESOLVED it, never as the body stated it. `sourceType` is always
                    // written (the resolved value equals the column default for an undeclared create, so the row is
                    // unchanged); the two nullable text columns are written as the policy's `null`, which is what
                    // "no external source" means — never `''`, which would render as an empty credit line.
                    sourceType: provenance.sourceType,
                    sourceUrl: provenance.sourceUrl,
                    sourceAttribution: provenance.sourceAttribution,
                    ingredientNamesText: plan.namesText,
                    // Denormalized author handle (W8-a.2) — absent → column stays NULL until the fan-out fills it.
                    ...(authorHandle !== undefined ? { authorHandle } : {}),
                    ingredients: plan.inputs,
                    steps: dto.steps.map(toStepInput),
                },
                tx,
            );

            await this.recordSnapshotIn(tx, created, plan.identities, principal.userId, 'Created', authorHandle);

            return created;
        });

        // Ask the verification gate about the transcribed lines (plan U11 / ADR-0024). A create has nothing
        // already on record, so `previous` is empty. Never throws — see `requestVerification`.
        //
        // ⛔ LAST, after the snapshot, and the UPDATE path does the same: this is a lossy, explicitly
        // droppable side effect, so nothing that must not be lost may sit behind it. Interposing it between
        // the committed write and the version snapshot would mean a stall delays — and a process death
        // loses — a snapshot, to buy nothing.
        //
        // ⛔ Reads `aggregate.ingredients` (the PERSISTED rows), not the pre-persistence lines: the DTO
        // carries an unrounded number while the column is `numeric(10,3)`, so the two can disagree on a
        // quantity — see `storedLineToVerifiable`.
        await this.requestVerification(principal, aggregate.recipe.id, aggregate.ingredients, plan.identities, []);

        // A freshly-created recipe has no photos yet (uploaded afterward); nutrition is computed from its lines.
        return this.detailAssembler.toDetailResponse(aggregate, [], {
            caller,
            budget: 'postCommit',
            viewerId: principal.userId,
        });
    }

    /**
     * Ask the verification gate about the lines this write changed (plan U11 / ADR-0024).
     *
     * ⛔ CALLED AFTER THE ROW IS PERSISTED, and its failure is SWALLOWED. Three rules, each with a reason:
     *
     *  - **After**, because the message carries the recipe's id — a producer that ran first would have
     *    nothing to name.
     *  - **Swallowed**, because the gate is a quality enhancement on an ASYNC path and
     *    `0023_line_verifications.sql` establishes that absence of a verdict means PUBLISH. A lost message
     *    degrades to exactly the behaviour the system had before the gate existed, so letting SQS fail a
     *    save would trade a quality improvement for an availability regression. It is logged at `error`
     *    so a SUSTAINED rate is visible as the "the gate is receiving nothing" signal it would be.
     *  - **⛔ Nothing at all for a CONTAINED test principal (ADR-0040).** The worker spends ADR-0024's shared
     *    production LLM pool and writes the GLOBAL `ingredient_resolution_memos` tier, which answers for every future
     *    cook and has no user column the test purge could reach — so, like analytics, it can only be PREVENTED. The
     *    return is the FIRST statement, before the provenance read, so a request never sent pays for nothing.
     *    `subject` is REQUIRED so a new caller cannot reach the queue without deciding.
     *
     * @param subject - Who is saving, and whether this stage contains test principals.
     * @param recipeId - The persisted recipe.
     * @param lines - The lines as they are now stored.
     * @param identities - The lines' identities, by lookup id, as this write's plan derived them.
     * @param previous - The recipe's lines BEFORE this write; empty on a create.
     * @sideEffect Sends SQS messages; logs on failure. Never throws.
     */
    private async requestVerification(
        subject: ContainmentSubject,
        recipeId: string,
        lines: readonly IngredientRow[],
        identities: LineIdentities,
        previous: readonly IngredientRow[],
    ): Promise<void> {
        if (isContained(subject)) {
            return;
        }

        // U2/U4: the latest resolution event per binding, batched over every line this call names.
        // Inside the same never-throws boundary as the enqueue — a failed read degrades to `unattributed`.
        const resolutions = await this.ingredientResolutions
            .latestResolutionsByLookupIds([...lines, ...previous].map((row) => row.foodLookupId))
            .catch((error: unknown) => {
                this.logger.warn(
                    'Resolution provenance read failed; verification proceeds unattributed.',
                    error instanceof Error ? error.stack : String(error),
                );

                return new Map<string, LatestResolution>();
            });

        const plan = buildVerificationRequests({
            recipeId,
            lines: lines.map((row) => storedLineToVerifiable(row, identities, resolutions)),
            alreadyRequested: previous.map((row) => storedLineToVerifiable(row, identities, resolutions)),
            thresholds: PROVISIONAL_VERIFICATION_THRESHOLDS,
            requestedAt: new Date().toISOString(),
            bands: await this.consultBands(resolutions),
        });
        const { requests, unasked } = plan;

        // ⛔ An over-cap line is the ONE unasked reason worth a log line. `authored` and
        // `no-catalog-identity` are the normal, dominant cases and would drown it; `over-cap` means the
        // system has permanently decided never to check a line a cook can see, and
        // `recipeRequestBounds.ts` says such a line should be "surfaced for correction". Observe-only ships
        // no `unresolved` state to write, so this log is the interim surface.
        const overCap = unasked.filter((entry) => entry.reason === 'over-cap');

        if (overCap.length > 0) {
            this.logger.warn(
                `recipe ${recipeId}: ${overCap.length} ingredient line(s) exceed the verification gate's ` +
                    `input cap and will never be checked (longest ${Math.max(
                        ...overCap.map((entry) => entry.observedChars ?? 0),
                    )} characters)`,
            );
        }

        if (requests.length === 0) {
            // ⛔ Not an empty batch — no call at all. `SendMessageBatch` REFUSES an empty `Entries` list
            // (`AWS.SimpleQueueService.EmptyBatchRequest`, verified against LocalStack), so an unguarded call
            // here would turn every hand-authored recipe save into a logged error.
            return;
        }

        try {
            await this.verificationQueue.enqueue(requests);
        } catch (error) {
            // ⛔ AN ISSUE, because the swallow is safe for the REQUEST and not for the GUARANTEE. Losing
            // these messages degrades to the pre-gate behaviour, which is why the save is not failed — but
            // it also means the gate silently stopped gating for this recipe, and nothing downstream can
            // distinguish a line nobody verified from a line whose request was dropped. The error's
            // identity is the only evidence of which is happening.
            Sentry.captureException(error);

            this.logger.error(
                `failed to enqueue ${requests.length} verification request(s) for recipe ${recipeId}; ` +
                    'the lines publish unverified, which is the behaviour that predates the gate',
                error instanceof Error ? error.stack : String(error),
            );
        }

        // KTD-A: identity settlements granted by band authority this save, persisted so revocation can
        // re-verify them (R14). Quietly — a lost skip row costs one re-verification, never a save.
        // Concurrent, not sequential: the rows are independent, and each write keeps its OWN catch, so a
        // failure still costs exactly one re-verification rather than the rest of the batch.
        await Promise.all(
            plan.bandSkips.map(async (skip) => {
                try {
                    await this.resolutionBands.recordSkip(skip.band, skip.epoch, skip.message);
                } catch (error) {
                    this.logger.warn(
                        'band-skip record failed; the settlement is unlogged for the drain',
                        error instanceof Error ? error.stack : String(error),
                    );
                }
            }),
        );

        // KTD-A: the withholding lines' ready messages, stored under the verdict store's own content key so
        // the scheduled drain can re-send any that age out with no verdict (plan U4c). Quietly — if BOTH
        // the enqueue above and this write fail, the age-bounded needs-review treatment is the backstop.
        // Concurrent for the same reason as the skips above: independent rows, per-write catch preserved.
        await Promise.all(
            plan.pendingRedrives.map(async (redrive) => {
                try {
                    await this.verificationRedrive.record(
                        verificationKey(redrive.judgement, (input) => createHash('sha256').update(input).digest('hex')),
                        redrive.message,
                    );
                } catch (error) {
                    this.logger.warn(
                        'pending-redrive record failed; the line relies on the age-bounded review treatment',
                        error instanceof Error ? error.stack : String(error),
                    );
                }
            }),
        );
    }

    /**
     * Load band authority (and roll the shadow coin) for every complete band key among this save's
     * resolution events.
     *
     * ⚠️ Quiet and total: with no bands DAL, or on any read failure, the map is simply missing entries —
     * and an absent consultation verifies identity, the safe direction (KTD-B's stale-read rule).
     *
     * @param resolutions - The latest events, by lookup id.
     * @returns Consultations by `bandKeyText`. @sideEffect Band-authority reads; one RNG roll per
     *   authorized band.
     */
    private async consultBands(
        resolutions: ReadonlyMap<string, LatestResolution>,
    ): Promise<ReadonlyMap<string, BandConsultation>> {
        const consultations = new Map<string, BandConsultation>();

        for (const resolution of resolutions.values()) {
            const key = bandKeyOf(resolution);

            if (key === undefined) {
                continue;
            }

            const text = bandKeyText(key);

            if (consultations.has(text)) {
                continue;
            }

            try {
                const authority = await this.resolutionBands.authorityFor(key);
                let shadow = false;

                if (authority?.state === 'authorized') {
                    // The ramped shadow rate: 50% during the burn-in after a grant, 5% steady — what keeps
                    // an authorized band's measured record accruing (plan U3).
                    const observed = await this.resolutionBands.observationsSinceGrant(key);
                    shadow = (this.rng ?? Math.random)() < shadowRateFor(observed);
                }

                consultations.set(text, { authority, shadow });
            } catch (error) {
                this.logger.warn(
                    'band-authority read failed; the affected lines verify identity',
                    error instanceof Error ? error.stack : String(error),
                );
            }
        }

        return consultations;
    }

    /**
     * Re-attach each resolved line's transcription — its raw source line AND the measure the source printed
     * before a historical unit was restated — from the currently-stored lines, per the pure
     * {@link carryForwardTranscription} rule.
     *
     * The stored rows are adapted here rather than in the policy: `quantity`/`quantity_high` arrive from
     * Drizzle as two nullable strings, and `quantityFromColumns` is the ONE adapter that turns them back into
     * the value object — the same one the read projection and `ingredientsChanged` use, so all three agree on
     * what a stored quantity IS.
     *
     * @param stored - The recipe's currently persisted lines.
     * @param resolved - The lines the update is about to persist, in final order.
     * @returns The same lines, each carrying the transcription it inherits (if any). Pure.
     */
    private withCarriedTranscription(
        stored: readonly IngredientRow[],
        resolved: readonly IngredientLineInput[],
    ): IngredientLineInput[] {
        const carried = carryForwardTranscription(
            stored.map((row) => ({
                foodLookupId: row.foodLookupId,
                quantity: quantityFromColumns(row),
                unit: row.unit,
                sourceLine: row.sourceLine ?? undefined,
                statedMeasure: statedMeasureFromColumns(row),
                sourcePhrase: row.sourcePhrase ?? undefined,
            })),
            resolved,
        );

        return resolved.map((line, index) => ({
            ...line,
            // Spread-if-present rather than assign-if-undefined: `IngredientLineInput` spells "this line
            // has none" by OMITTING the key, matching the way the wire and the DAL both spell it, so an
            // explicit `undefined` would put a second spelling of absence into the persistence path.
            ...(carried[index]?.sourceLine === undefined ? {} : { sourceLine: carried[index]?.sourceLine }),
            ...(carried[index]?.statedMeasure === undefined ? {} : { statedMeasure: carried[index]?.statedMeasure }),
            ...(carried[index]?.sourcePhrase === undefined ? {} : { sourcePhrase: carried[index]?.sourcePhrase }),
        }));
    }

    /**
     * Fetch one recipe. Allowed for the owner, or for any `public` recipe.
     *
     * @param request - Who is viewing (`viewerId`), which recipe (`id`), the caller's token for the food
     *   service, and the nutrition `budget`: `'read'` for the detail route, `'postCommit'` when a caller re-reads
     *   a recipe it has just written. Named, not positional: the viewer and recipe ids are both strings.
     * @returns The recipe detail.
     * @throws {RecipeDomainError} `RECIPE_NOT_FOUND` when the recipe is absent or not viewable by this viewer.
     */
    public async getById(request: GetRecipeRequest): Promise<RecipeResponse> {
        const { viewerId: ownerId, id, caller, budget } = request;
        const aggregate = await this.dal.findById(id);

        if (!aggregate) {
            throw recipeNotFound(id);
        }

        // W8-a.4 (IDOR): a recipe the caller can't see (private/draft, not owned) is 404 — indistinguishable
        // from a missing id — not 403, which would confirm the id exists. getById is the hottest such path.
        if (!isRecipeViewableBy(aggregate.recipe, ownerId)) {
            throw recipeNotFound(id);
        }

        // The viewer's OWN rating (FR-013) for `viewerRating`, scoped to (recipe, this viewer) so it can
        // only ever be the caller's own stars — one indexed point lookup on this single-recipe read.
        // `undefined` (viewer has not rated, incl. the owner viewing their own recipe) → the field is absent.
        const [photos, viewerRating] = await Promise.all([
            this.detailAssembler.loadPhotoRows(id),
            this.ratingsDal.findStars(id, ownerId),
        ]);

        return this.detailAssembler.toDetailResponse(aggregate, photos, {
            caller,
            budget,
            ...(viewerRating !== undefined ? { viewerRating } : {}),
            viewerId: ownerId,
        });
    }

    /**
     * The recipe ROW a viewer may read — the authorization question alone, without building a detail.
     *
     * ⛔ Use this, not {@link getById}, when the body would be discarded. `getById` is the DETAIL read: it
     * loads photos, the viewer's rating, the bindings, two food requests and the verification verdicts.
     * Photos, versions and ratings used it to authorize and threw all of that away.
     *
     * @param viewerId - The requesting principal's app-user ULID.
     * @param id - The recipe id.
     * @returns The active recipe row.
     * @throws {RecipeDomainError} `RECIPE_NOT_FOUND` when the recipe is missing, tombstoned, or not viewable by
     *   this viewer — the same answer for all three, so the response is never an existence oracle (W8-a.4).
     * @sideEffect One `recipes` read.
     */
    public async findReadableRecipe(viewerId: string, id: string): Promise<RecipeRow> {
        const recipe = await this.dal.findRowById(id);

        if (!recipe || !isRecipeViewableBy(recipe, viewerId)) {
            throw recipeNotFound(id);
        }

        return recipe;
    }

    /**
     * The recipe ROW a caller owns — for a mutation that is not this vertical's own (photos, a version restore).
     *
     * @param ownerId - The requesting principal's app-user ULID.
     * @param id - The recipe id.
     * @returns The active recipe row.
     * @throws {RecipeDomainError} `RECIPE_NOT_FOUND` when the recipe is missing, tombstoned, or not viewable;
     *   `NOT_OWNER` only for a recipe the caller CAN see but does not own — see {@link assertOwner}.
     * @sideEffect One `recipes` read.
     */
    public async findOwnedRecipe(ownerId: string, id: string): Promise<RecipeRow> {
        const recipe = await this.dal.findRowById(id);

        if (!recipe) {
            throw recipeNotFound(id);
        }

        this.assertOwner(ownerId, recipe);

        return recipe;
    }

    /** List the caller's own recipes (owner-scoped, tombstones excluded), paginated. */
    public async list(ownerId: string, query: ListRecipesQueryDto): Promise<PaginatedRecipesResponse> {
        const { page, pageSize, sortBy } = query;
        const { rows, total } = await this.dal.findAll({ ownerId, page, pageSize, sortBy });

        return {
            // The published list item — no lines, steps, photos or nutrition, but WITH the derived cover URL
            // resolved from the DAL's cover-photo key (one cover LATERAL for the page; no N+1). The explicit
            // arrow is required (a bare `.map(toRecipeSummaryResponse)` would pass the index as the extras arg).
            data: rows.map((row) =>
                toRecipeSummaryResponse(row, {
                    ...(row.coverPhotoKey !== undefined
                        ? { coverPhotoUrl: resolveCdnUrl(this.photosCdnUrl, row.coverPhotoKey) }
                        : {}),
                }),
            ),
            ...toPageEnvelope({ total, page, pageSize, rowCount: rows.length }),
        };
    }

    /**
     * Update a recipe the caller owns, enforcing optimistic concurrency (T033), and record a version
     * snapshot of the result. `options.snapshot` states WHAT that version records; it can no longer be
     * suppressed. The old `recordSnapshot: false` was the one path that committed a recipe write with no
     * version row — an opt-out of a system invariant, granted to the RESTORE
     * path (which records its own snapshot with restore-specific provenance) so a restore writes exactly
     * one version, not two at the same number. `options.changeSummary` labels the recorded version.
     */
    public async update(
        principal: Principal,
        id: string,
        dto: UpdateRecipeDto,
        caller: CallerToken | undefined,
        options: { readonly snapshot?: SnapshotDirective } = {},
    ): Promise<RecipeResponse> {
        const ownerId = principal.userId;
        const existing = await this.findEditableAggregate(ownerId, id, dto.expectedVersion, caller);

        // Plan replacement lines only when the patch carries them (absent → links untouched).
        // ⛔ The resolved lines are then handed the TRANSCRIPTION the stored lines already hold. `PATCH`
        //    cannot carry a `sourceLine` (create-only, ADR-0023's shape) and `replaceForRecipe` swaps the
        //    whole set, so without this a title edit would destroy every source line on an imported recipe —
        //    and BOTH shipped clients send `ingredients` on every save (`toUpdateRecipeInput` spreads
        //    `toCreateRecipeInput`, which always emits the array), so "a metadata-only PATCH preserves them"
        //    describes a request no app makes. The rule is `domain/transcriptionCarryForward.ts`; it is applied
        //    HERE because this is the only layer holding both the stored aggregate and the resolved lines.
        const plan = dto.ingredients !== undefined ? await this.planner.plan(caller, dto.ingredients) : undefined;
        const ingredients =
            plan === undefined ? undefined : this.withCarriedTranscription(existing.ingredients, plan.inputs);
        // The version snapshot needs every line's identity. A patch without lines keeps the stored ones, whose
        // identities are read here — OUTSIDE the transaction, because it asks food.
        const identities =
            plan?.identities ??
            (await this.identities.identify(
                caller,
                existing.ingredients.map((row) => row.foodLookupId),
                'postCommit',
            ));

        // ⛔ No lead-calorie recompute here any more (plan U10). This block existed to keep a denormalized
        // column in step with the lines and the serving count; with the column dropped there is nothing to
        // keep in step, and the figure is derived on every detail read from food's live data instead.

        // C-004 / FR-005: a change to ingredients/steps flips `hasSubstantiveEdit` to true (once true, it
        // stays true — never reset). Only newly-substantive edits are persisted; the import provenance
        // columns are never touched here, so imported lineage survives the version bump (T139).
        // Judged over the lines AS STORED: a line naming a settled failure was forwarded to the settle target by the
        // planner, and a stale save that only re-sends it is not an ingredient edit (plan 002 R13).
        const storedDto =
            dto.ingredients === undefined || plan === undefined
                ? dto
                : {
                      ...dto,
                      ingredients: dto.ingredients.map((line, index) => ({
                          ...line,
                          ingredientId: plan.inputs[index]?.foodLookupId ?? line.ingredientId,
                      })),
                  };
        const newlySubstantive = !existing.recipe.hasSubstantiveEdit && detectSubstantiveEdit(existing, storedDto);

        // A recipe may EXIST empty — that is what a draft IS — but it may not be PUBLISHED empty. The wire
        // schema rejects a body that publishes while sending an empty array; only the service can judge the
        // body that publishes WITHOUT resending the arrays, because only it knows what is already stored.
        // Counting the patch when present and the persisted rows otherwise is the same "absent means
        // unchanged" rule the DAL applies below, evaluated against the post-update state.
        if (dto.status === RecipeStatus.PUBLISHED) {
            const ingredientCount = dto.ingredients?.length ?? existing.ingredients.length;
            const stepCount = dto.steps?.length ?? existing.steps.length;

            if (ingredientCount === 0 || stepCount === 0) {
                throw new BadRequestException('A published recipe needs at least one ingredient and one step.');
            }
        }

        // ⛔ ONE TRANSACTION, and the CAS miss must LEAVE it before it is diagnosed. `raiseVersionConflict`
        // calls `dal.readConflict`, which opens its own transaction AND issues
        // `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` — a second pooled connection, and a statement
        // Postgres rejects once one has already run. So the callback returns `undefined` and the 409 is
        // raised outside; nothing was written, so committing an empty transaction is correct and cheaper
        // than forcing a rollback.
        const updated = await this.dal.transaction(async (tx) => {
            const result = await this.dal.update(
                id,
                {
                    // The version predicate makes the write an atomic compare-and-swap (closes the lost-update
                    // race the read-then-check above cannot). The pre-check stays for the fast, clear-error path.
                    expectedVersion: dto.expectedVersion,
                    title: dto.title,
                    description: dto.description,
                    cuisine: dto.cuisine,
                    servings: dto.servings,
                    prepTimeMinutes: dto.prepTimeMinutes,
                    cookTimeMinutes: dto.cookTimeMinutes,
                    totalTimeMinutes: dto.totalTimeMinutes,
                    // Three-state difficulty (FR-001b) passed straight through: `undefined` leaves it unchanged, a
                    // value sets it, explicit `null` clears it. The DAL is what distinguishes the three — the DTO
                    // preserved absent-vs-null, and forwarding the raw value keeps that distinction intact.
                    difficulty: dto.difficulty,
                    // Three-state meal type (plan U34) passed straight through, exactly as difficulty is: `undefined`
                    // leaves it unchanged, a value sets it, an explicit `null` clears it back to "not stated".
                    mealType: dto.mealType,
                    // Publication status (W8-a.3) — passed straight through: absent leaves it unchanged, a value
                    // sets it (Publish / re-draft). The DAL keys off `!== undefined`.
                    status: dto.status,
                    tags: dto.tags,
                    dietaryFlags: dto.dietaryFlags,
                    // Rebuild the search text from the lines' identities (never the request body) — only when the
                    // patch actually replaces the lines.
                    ...(plan !== undefined && ingredients !== undefined
                        ? { ingredientNamesText: plan.namesText, ingredients }
                        : {}),
                    ...(dto.steps !== undefined ? { steps: dto.steps.map(toStepInput) } : {}),
                    ...(newlySubstantive ? { hasSubstantiveEdit: true } : {}),
                },
                tx,
            );

            if (!result) {
                return undefined;
            }

            // Editor handle (W8-a.2) — the version's "by @handle" attribution. Derived from the editor's
            // token claims via the ONE shared rule create uses; `author_handles` is deliberately NOT the
            // source here (it is seeded only by rename events, so it is NULL for any un-renamed user).
            const editorHandle = deriveDisplayName(principal) || undefined;

            await this.recordSnapshotIn(
                tx,
                result,
                identities,
                ownerId,
                options.snapshot?.changeSummary ?? 'Updated',
                editorHandle,
                options.snapshot?.baseVersion,
            );

            return result;
        });

        if (!updated) {
            // The CAS matched 0 rows: either the row was tombstoned, or a concurrent update advanced the
            // version between our read and our write (the lost-update race). Raise the enriched 409 (or a
            // 404 if the row is genuinely gone). `return` narrows `updated` to defined below.
            return this.raiseVersionConflict(id, dto.expectedVersion, caller);
        }

        if (plan !== undefined) {
            // ⛔ `existing.ingredients` is the ALREADY-REQUESTED set, and it is what stops a title edit from
            // re-paying for every line: `replaceForRecipe` rewrites the whole set on every save, and both
            // shipped clients send `ingredients` on every save. A patch carrying no `ingredients` asks
            // nothing at all, because no judgement moved. LAST, for the reason `create` states.
            await this.requestVerification(principal, id, updated.ingredients, plan.identities, existing.ingredients);
        }

        return this.detailAssembler.toDetailResponse(updated, await this.detailAssembler.loadPhotoRows(id), {
            caller,
            budget: 'postCommit',
            viewerId: ownerId,
        });
    }

    /**
     * The recipe a caller may edit at the version they edited — the one check every write runs BEFORE it writes.
     *
     * A line-level command (the rebind, plan 002 U5) resolves a food and records a correction before it re-saves the
     * recipe, so it runs this first: a caller who does not own the recipe, or who edited a stale version, is refused
     * before anything is written.
     *
     * @param ownerId - The caller's app-user ULID.
     * @param id - The recipe id.
     * @param expectedVersion - The version the caller edited.
     * @param caller - The caller's credential, for the conflict's server-side names.
     * @returns The recipe's aggregate.
     * @throws {RecipeDomainError} `RECIPE_NOT_FOUND` for a missing or unseeable recipe, `NOT_OWNER` for a visible one
     *   the caller does not own, and the enriched `VERSION_CONFLICT` (W8-a.5) for a stale version — the same 409 the
     *   write's own compare-and-swap raises, so every conflict carries the server and base snapshots.
     * @sideEffect One aggregate read; on a stale version, the conflict read and one food request.
     */
    public async findEditableAggregate(
        ownerId: string,
        id: string,
        expectedVersion: number,
        caller: CallerToken | undefined,
    ): Promise<RecipeAggregate> {
        const existing = await this.dal.findById(id);

        if (!existing) {
            throw recipeNotFound(id);
        }

        this.assertOwner(ownerId, existing.recipe);

        if (existing.recipe.currentVersion !== expectedVersion) {
            return this.raiseVersionConflict(id, expectedVersion, caller);
        }

        return existing;
    }

    /** Soft-delete (tombstone) a recipe the caller owns. */
    public async delete(ownerId: string, id: string): Promise<void> {
        const existing = await this.dal.findById(id);

        if (!existing) {
            throw recipeNotFound(id);
        }

        this.assertOwner(ownerId, existing.recipe);

        const removed = await this.dal.softDelete(id);

        if (!removed) {
            throw recipeNotFound(id);
        }
    }

    /**
     * Clone a recipe (FR-011). Only a `public` recipe is cloneable by a non-owner; an owner may clone
     * their own (even private). The clone is a NEW recipe owned by the caller with
     * `clonedFromId = source.id`, the source's attribution RETAINED
     * (`sourceType`/`sourceUrl`/`sourceAttribution`), content copied, `hasSubstantiveEdit = false`, and
     * `visibility` set to the C-004 clone default for the source type. The ORIGINAL is never mutated.
     */
    public async clone(principal: Principal, id: string, caller: CallerToken | undefined): Promise<RecipeResponse> {
        const ownerId = principal.userId;
        const source = await this.dal.findById(id);

        if (!source) {
            throw recipeNotFound(id);
        }

        // Clone read-scoping (FR-011 / W8-a.3+.4): a non-owner may clone only a public, PUBLISHED recipe; an
        // owner may clone their own (even private/draft). Routes through the single in-memory viewability
        // predicate (the twin of the `readableBy` DAL predicate). An unreadable source (private/draft, not
        // owned) returns 404 — indistinguishable from a missing id (IDOR), not 403.
        if (!isRecipeViewableBy(source.recipe, ownerId)) {
            throw recipeNotFound(id);
        }

        // ADR-0040 — AFTER the viewability 404, so containment can never confirm a private recipe exists: a contained
        // test principal may clone only its OWN recipe. A foreign clone would tie a test row into a real user's
        // erasure provenance (their erasure rewrites every clone of their recipes).
        if (source.recipe.ownerId !== ownerId) {
            assertNotContained(principal, 'cloneForeign');
        }

        const sourceType = source.recipe.sourceType as RecipeSourceType;
        // A user_created original carries no attribution — record it to the original author so the clone
        // still credits provenance. An imported source already carries its attribution; keep it verbatim.
        const attribution = source.recipe.sourceAttribution ?? `Cloned from ${source.recipe.ownerId}`;

        // U13 (R20), plan 002 R9: the clone KEEPS every binding, including one to another author's private food,
        // which renders as unavailable to the cloner. Its identities are read with the CLONER's credential, and the
        // search text and the first version store only shareable names, so the clone publishes no private name.
        const identities = await this.identities.identify(
            caller,
            source.ingredients.map((row) => row.foodLookupId),
            'postCommit',
        );
        const hiddenCount = countHiddenFromViewer(source.ingredients, identities, ownerId);

        // Editor handle (W8-a.2) — derived from the cloner's token claims via the ONE shared rule. Pure,
        // so it is computed OUTSIDE the transaction with every other derivation.
        const editorHandle = deriveDisplayName(principal) || undefined;

        // ⛔ ONE TRANSACTION, exactly as `create` — the clone and its first version row commit together.
        const created = await this.dal.transaction(async (tx) => {
            const cloned = await this.dal.create(
                {
                    ownerId,
                    title: source.recipe.title,
                    ...(source.recipe.description !== null ? { description: source.recipe.description } : {}),
                    ...(source.recipe.cuisine !== null ? { cuisine: source.recipe.cuisine } : {}),
                    visibility: defaultCloneVisibility(sourceType, principal),
                    servings: source.recipe.servings,
                    prepTimeMinutes: source.recipe.prepTimeMinutes,
                    cookTimeMinutes: source.recipe.cookTimeMinutes,
                    totalTimeMinutes: source.recipe.totalTimeMinutes,
                    tags: source.recipe.tags,
                    dietaryFlags: source.recipe.dietaryFlags,
                    sourceType,
                    sourceUrl: source.recipe.sourceUrl,
                    sourceAttribution: attribution,
                    clonedFromId: source.recipe.id,
                    hasSubstantiveEdit: false,
                    ingredientNamesText: ingredientNamesText(
                        source.ingredients.map((row) => row.foodLookupId),
                        identities,
                    ),
                    ingredients: source.ingredients.map(toClonedLineInput),
                    steps: source.steps.map(toStepInputFromRow),
                },
                tx,
            );

            await this.recordSnapshotIn(
                tx,
                cloned,
                identities,
                ownerId,
                `Cloned from ${source.recipe.id}`,
                editorHandle,
            );

            return cloned;
        });

        // A fresh clone starts with no photos (not copied from the source); nutrition is computed from its lines.
        const detail = await this.detailAssembler.toDetailResponse(created, [], {
            caller,
            budget: 'postCommit',
            viewerId: ownerId,
        });

        // The banner's number — only on a clone with lines the cloner may not see, so the ordinary clone's wire
        // bytes are unchanged.
        return hiddenCount > 0 ? { ...detail, clonePrivateFoodLineCount: hiddenCount } : detail;
    }

    /**
     * Set a recipe's visibility (C-004 / T050), owner-only, gated by the pure {@link evaluateVisibility}
     * policy over `(sourceType, isPremium, hasSubstantiveEdit, requested)`. Premium is derived from the
     * principal's `permissions` (see {@link PREMIUM_PERMISSION}) — there is no tier field until 010. A
     * denied transition throws `INVALID_VISIBILITY` (→ 400); an allowed one persists without bumping the
     * content version.
     */
    public async setVisibility(
        principal: Principal,
        id: string,
        visibility: RecipeVisibility,
        caller: CallerToken | undefined,
    ): Promise<RecipeResponse> {
        const existing = await this.dal.findById(id);

        if (!existing) {
            throw recipeNotFound(id);
        }

        this.assertOwner(principal.userId, existing.recipe);

        const isPremium = principal.permissions.includes(PREMIUM_PERMISSION);
        const decision = evaluateVisibility({
            principalKind: principal.principalKind,
            containment: principal.containment,
            sourceType: existing.recipe.sourceType as RecipeSourceType,
            isPremium,
            hasSubstantiveEdit: existing.recipe.hasSubstantiveEdit,
            requested: visibility,
        });

        if (!decision.allowed) {
            throw decision.denial === 'contained'
                ? testPrincipalContained(decision.reason)
                : invalidVisibility(decision.reason, { visibility, sourceType: existing.recipe.sourceType });
        }

        const updated = await this.dal.setVisibility(id, visibility);

        if (!updated) {
            // The active row vanished between the read and the write (a concurrent tombstone).
            throw recipeNotFound(id);
        }

        return this.detailAssembler.toDetailResponse(updated, await this.detailAssembler.loadPhotoRows(id), {
            caller,
            budget: 'postCommit',
            viewerId: principal.userId,
        });
    }

    /** Owner-only guard for mutations: `owner_id == principal.userId` or `NOT_OWNER`. */
    /**
     * Assemble and throw the enriched `409 VERSION_CONFLICT` (W8-a.5) — or a `404` when the recipe is gone —
     * from the coherent {@link RecipesDal.readConflict} read. The ONE place both the fast pre-check and the
     * CAS-miss produce a conflict, so every 409 carries the same `{ server, base? }` snapshots read from a
     * single snapshot (a third writer can't make `server` a version ahead of the reported `currentVersion`).
     * Owner-only by construction: only the owner-gated update path calls it (a non-owner already got 404).
     */
    private async raiseVersionConflict(
        id: string,
        expectedVersion: number,
        caller: CallerToken | undefined,
    ): Promise<never> {
        const conflict = await this.dal.readConflict(id, expectedVersion);

        if (!conflict) {
            throw recipeNotFound(id);
        }

        // AFTER `readConflict` has left its transaction: the server side's names come from food.
        const identities = await this.identities.identify(
            caller,
            conflict.current.ingredients.map((row) => row.foodLookupId),
            'read',
        );
        const server: VersionConflictSide = {
            versionNumber: conflict.current.recipe.currentVersion,
            updatedAt: conflict.current.recipe.updatedAt.toISOString(),
            snapshot: aggregateToSnapshot(conflict.current, identities),
        };
        const base: VersionConflictSide | undefined =
            conflict.baseVersion !== undefined
                ? {
                      versionNumber: conflict.baseVersion.versionNumber,
                      updatedAt: conflict.baseVersion.createdAt.toISOString(),
                      snapshot: conflict.baseVersion.snapshot as RecipeSnapshot,
                  }
                : undefined;

        throw versionConflict(conflict.current.recipe.currentVersion, expectedVersion, {
            server,
            ...(base !== undefined ? { base } : {}),
        });
    }

    private assertOwner(ownerId: string, recipe: RecipeRow): void {
        // W8-a.4 (IDOR): a recipe the caller cannot even SEE (private/draft, not owned) returns 404 —
        // indistinguishable from a missing id — closing the existence oracle a bare owner check (403) opens
        // on `update`/`delete`/`setVisibility` (all reachable via a leaked clonedFromId/collection/version
        // reference). A recipe the caller CAN see but does not OWN (public, other-owner) still returns 403:
        // you can see it, you just can't modify it — not an oracle.
        if (!isRecipeViewableBy(recipe, ownerId)) {
            throw recipeNotFound(recipe.id);
        }

        if (recipe.ownerId !== ownerId) {
            throw notOwner(recipe.id);
        }
    }
}
