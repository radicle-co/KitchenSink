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
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { isBoundBy, quantitiesEqual, type RecipeSnapshot, type VersionConflictSide } from '@kitchensink/recipe-core';
import { verificationKey } from '@kitchensink/recipe-core/resolution/verification-key';
import {
    verifiedLineIdentityOfMessage,
    type VerifyIngredientLineMessage,
} from '@kitchensink/recipe-core/resolution/verification-message';
import { PROVISIONAL_VERIFICATION_THRESHOLDS } from '@kitchensink/recipe-core/resolution/verification-gate-policy';
import {
    RecipeSourceType,
    RecipeStatus,
    RecipeVisibility,
    recipeSourceTypeSchema,
    recipeStatusSchema,
} from '@kitchensink/recipe-core';

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
    privateSlotsFull,
    provenanceNotPermitted,
    publishRequirementsUnmet,
    recipeNotFound,
    versionConflict,
    privateFoodsOnPublicRecipe,
} from './recipe.error.js';
import type { PrivateSlotUsage } from './recipes.schema.js';
import { evaluateProvenance, type ResolvedProvenance } from './domain/provenancePolicy.js';
import {
    resolveLineBindings,
    type DirectedBinding,
    type LineOriginDirective,
    type StoredBinding,
} from './domain/bindingOriginCarryForward.js';
import { evaluatePublication, type PublishPolicyInput } from './domain/publishPolicy.js';
import { evaluatePublicFoods, type PublicFoodsLine } from './domain/publicFoodsPolicy.js';
import {
    SLOT_NOT_NEEDED,
    privateSlotAllowanceOf,
    privateSlotStandingOf,
    requiresPrivateSlotCheck,
    slotRuleApplies,
    type PrivateSlotStanding,
} from './domain/privateSlotPolicy.js';
import { defaultCloneVisibility, evaluateVisibility, type VisibilityPolicyInput } from './domain/visibilityPolicy.js';
import { isContained, type ContainmentSubject } from '../common/containmentPolicy.js';
import { assertNotContained, testPrincipalContained } from '../common/containment.error.js';
import { isRecipeViewableBy } from './domain/recipeVisibility.js';
import { recordsVersion } from './domain/versionPolicy.js';
import { toRecipeSummaryResponse } from './mappers/recipeResponse.js';
import { resolveCdnUrl } from '../photos/photoView.js';
import type { CreateRecipeDto, CreateRecipeStepInputDto, RecipeIngredientInputDto } from './dto/createRecipe.dto.js';
import { carryForwardTranscription } from './domain/transcriptionCarryForward.js';
import { buildVerificationRequests, type VerifiableLine } from './domain/verificationRequests.js';
import { VERIFICATION_QUEUE, type VerificationQueuePort } from './verification.queue.js';
import { withoutVerdictsOnRecord } from './verdictDedup.js';
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
import { isPremiumPrincipal, type Principal } from '../auth/principal.js';
import { AuthorHandlesDal } from '../authors/dal/authorHandles.dal.js';
import { resolveByline, type Byline } from '../authors/domain/bylinePolicy.js';
import type { CallerToken } from '../auth/CallerToken.js';
import type { NutritionReadBudget } from '../ingredients/foodNutrition.gateway.js';
import {
    RECIPES_DAL,
    RECIPE_LINE_VERIFICATIONS_DAL,
    RECIPE_PHOTOS_CDN_URL,
    RECIPE_RATINGS_DAL,
} from './recipes.tokens.js';
import type { LineVerificationsDal } from './dal/lineVerifications.dal.js';
import { sha256Hex } from '../common/sha256.js';
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
function storedLineToVerifiable(row: IngredientRow, identities: LineIdentities): VerifiableLine {
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
        // U11 (0040): whether this line's food is someone's PRIVATE authored one. Rides to the worker as the
        // message's `privateFood` — no memo write, no band observation for a food only its author sees. The owner
        // is on the binding, so this can no longer fail to be read.
        privateFood: identity !== undefined && privateFoodOwnerOf(identity.arm) !== undefined,
    };
}

/**
 * Refuse a write that would leave a recipe published without what Publish needs (`domain/publishPolicy.ts`).
 *
 * @param state - The status, provenance and content the write would leave.
 * @throws {RecipeDomainError} `PUBLISH_REQUIREMENTS_UNMET`, naming every gap. Pure apart from the throw.
 */
function assertPublishable(state: PublishPolicyInput): void {
    const decision = evaluatePublication(state);

    if (!decision.allowed) {
        throw publishRequirementsUnmet(decision.reason, decision.missing);
    }
}

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
        ...(row.note !== null ? { note: row.note } : {}),
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
                ...(line.note !== null ? { note: line.note } : {}),
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
            (row.displayText ?? null) !== (next.displayText ?? null) ||
            (row.note ?? null) !== (next.note ?? null) ||
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

/**
 * The recipe row's two byline columns for a resolved byline — each omitted when unknown, so its column stays NULL
 * rather than holding `''`. Pure.
 */
function bylineColumnsOf(byline: Byline): { authorDisplayName?: string; authorUsername?: string } {
    return {
        ...(byline.displayName !== undefined ? { authorDisplayName: byline.displayName } : {}),
        ...(byline.username !== undefined ? { authorUsername: byline.username } : {}),
    };
}

/**
 * The refusal of a move to private for want of a slot (ADR-0073), with the count and the limit the cook is told. Pure.
 *
 * ONE place builds it: `create`, `setVisibility` and `clone` all end here, so the three cannot word it differently.
 */
function slotsFullError(standing: Extract<PrivateSlotStanding, { hasAvailablePrivateSlot: false }>): Error {
    return privateSlotsFull(standing.used, standing.limit);
}

/**
 * Judge a visibility request against the cook's standing and throw its refusal.
 *
 * The policy's slot fact is DERIVED from `standing` here, never passed beside it: two facts that must agree could be built
 * to disagree. Three denials, three answers: a contained test principal's publish is a 403 of its own (ADR-0040), a full
 * set of private slots is the 403 `PRIVATE_SLOTS_FULL` carrying `used` and `limit` (ADR-0073), and any other C-004 refusal
 * is the 400 `INVALID_VISIBILITY`.
 *
 * @param ask - The request, without the slot fact.
 * @param standing - The cook's standing, read under the per-user lock where a slot matters.
 * @throws {HttpException} The refusal, when the policy denies.
 */
function assertVisibilityAllowed(
    ask: Omit<VisibilityPolicyInput, 'hasAvailablePrivateSlot'>,
    standing: PrivateSlotStanding,
): void {
    const decision = evaluateVisibility({ ...ask, hasAvailablePrivateSlot: standing.hasAvailablePrivateSlot });

    if (decision.allowed) {
        return;
    }

    if (decision.denial === 'contained') {
        throw testPrincipalContained(decision.reason);
    }

    // The policy denies for want of a slot only when the standing it was handed has none, so `used` is there to state.
    if (decision.denial === 'privateSlots' && !standing.hasAvailablePrivateSlot) {
        throw slotsFullError(standing);
    }

    throw invalidVisibility(decision.reason, { visibility: ask.requested, sourceType: ask.sourceType });
}

/**
 * The C-004 question for a recipe asking to hold `requested`, without the slot fact. Pure.
 *
 * The one place that builds it, so create, update (publishing a private draft) and set-visibility cannot disagree about
 * which fields the policy is asked with.
 *
 * @param principal - The verified caller.
 * @param recipe - The recipe's provenance label.
 * @param requested - The visibility asked for.
 */
function visibilityAskOf(
    principal: Principal,
    recipe: { readonly sourceType: RecipeSourceType },
    requested: RecipeVisibility,
): Omit<VisibilityPolicyInput, 'hasAvailablePrivateSlot'> {
    return {
        principalKind: principal.principalKind,
        containment: principal.containment,
        sourceType: recipe.sourceType,
        isPremium: isPremiumPrincipal(principal),
        requested,
    };
}

/**
 * What the BULK IMPORT's save adds to a create (ADR-0072 §3, §9). An INTERNAL channel: it is an argument to
 * {@link RecipesService.create}, never a field of a request body.
 *
 * ⛔ `provenance` is the one place `imported_public` (and the private-only labels) is set without the curator grant that
 * `POST /api/v1/recipes` requires. ADR-0023's exception is for the import route only, and what backs the label is the
 * cook's stored per-recipe statement and citation. It still passes through visibility: the caller judges the recipe against
 * THIS provenance, so a book recipe cannot be public.
 */
export interface ImportedCreate {
    /** The provenance the per-recipe statement set. */
    readonly provenance: ResolvedProvenance;
    /** One directive per ingredient line, in line order: the origin the import states and the snapshot line it came from. */
    readonly lineOrigins: readonly LineOriginDirective[];
    /**
     * Runs INSIDE the recipe's transaction, right after the recipe row is written, with what was persisted. The import uses it
     * to claim its item (`UPDATE … WHERE saved_at IS NULL`) in the same transaction as the recipe, so two saves of one item
     * cannot both commit, and to store the verdict key of each saved line. A throw rolls the whole create back.
     */
    readonly afterWrite?: (tx: RecipeTx, saved: SavedRecipe) => Promise<void>;
}

/** What a create persisted, as `afterWrite` sees it. */
interface SavedRecipe {
    readonly recipeId: string;
    /** The persisted lines, in line order. */
    readonly ingredients: readonly IngredientRow[];
    /** Each line's binding and what food named it, by binding id (the arm tells a food from a line kept as written). */
    readonly identities: ReadonlyMap<string, IngredientLineIdentity>;
}

/** What a caller of {@link RecipesService.update} may state beyond the request: the save path's own directives. */
export interface UpdateOptions {
    readonly snapshot?: SnapshotDirective;
    /**
     * Origin directives by line POSITION in this request (the rebind builds its lines from the stored ones in the same call,
     * so the position is stable). Internal: never a request field.
     */
    readonly lineOrigins?: ReadonlyMap<number, LineOriginDirective>;
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
        // ADR-0071 — the producer's dedup read: a verdict already on record under a line's key is not paid for again.
        // REQUIRED like the queue above. Token-injected, so the `Pick` type emits nothing Nest must resolve.
        @Inject(RECIPE_LINE_VERIFICATIONS_DAL)
        private readonly verdicts: Pick<LineVerificationsDal, 'findExistingKeys'>,
        // U-DA — the READ-side collaborator (`recipeDetail.assembler.ts`). Every detail projection that needs
        // the food service lives there, behind three public methods; this class keeps the orchestration and
        // the writes. ⛔ Call it only AFTER a transaction has committed: no signature there accepts a `RecipeTx`, so
        // it cannot USE one — but nothing stops a caller awaiting it inside a transaction callback, so ADR-0034's
        // "never hold a transaction across a network call" is still a rule each call site keeps.
        private readonly detailAssembler: RecipeDetailAssembler,
        // Plan 2026-10-15-010 D8 — the read model a write's byline is resolved from. Required like the others.
        // ⚠️ Token-injected with a VALUE import: the `Pick` type emits `Object` into design:paramtypes.
        @Inject(AuthorHandlesDal) private readonly authorHandles: Pick<AuthorHandlesDal, 'findByline'>,
    ) {}

    /** One logger for the producer — a queue that is refusing work must be visible, never silent. */
    private readonly logger = new Logger(RecipesService.name);

    /**
     * The caller's byline for a write, read-model-first (plan 2026-10-15-010 D8).
     *
     * @param tx - The write's transaction — the read locks the read-model row `FOR SHARE` inside it.
     * @param principal - The verified caller.
     * @returns The byline to store.
     * @sideEffect Reads `author_handles` inside `tx`.
     */
    private async bylineIn(tx: RecipeTx, principal: Principal): Promise<Byline> {
        return resolveByline(await this.authorHandles.findByline(principal.userId, tx), principal);
    }

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
        editor: Byline,
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
                // The version editor's byline (W8-a.2 + plan 2026-10-15-010) — each half omitted → NULL.
                ...(editor.displayName !== undefined ? { editorDisplayName: editor.displayName } : {}),
                ...(editor.username !== undefined ? { editorUsername: editor.username } : {}),
                // The version this write was restored FROM, when it was a restore. Absent otherwise.
                ...(baseVersion !== undefined ? { baseVersion } : {}),
            },
            tx,
        );
    }

    /**
     * Refuse a write that would leave a recipe published and public while a line is bound to a private food (ADR-0029
     * section 4), after RECAPTURING: a food promoted since it was bound is public now and its captured owner is stale.
     *
     * Asks food only when the policy would deny, so a private recipe, a draft, or a recipe with no private food costs
     * no call. Fails CLOSED: a food that is still private, absent or unreachable keeps its captured value.
     *
     * @param caller - The writer's credential, forwarded to food as the author.
     * @param state - The status and visibility the write leaves.
     * @param lines - The lines the write leaves, by position and binding.
     * @param identities - Those bindings' identities, by lookup id.
     * @returns The foods food reports public, whose captured owner the write clears INSIDE its transaction.
     * @throws {RecipeDomainError} `PRIVATE_FOODS_ON_PUBLIC_RECIPE`, naming every line still bound to a private food.
     * @sideEffect At most one batched food request.
     */
    private async publicFoodsGuard(
        caller: CallerToken | undefined,
        state: { readonly status: RecipeStatus; readonly visibility: RecipeVisibility },
        lines: readonly { readonly foodLookupId: string; readonly sortOrder: number }[],
        identities: LineIdentities,
    ): Promise<readonly string[]> {
        const rootLines = lines.flatMap((line): PublicFoodsLine[] => {
            const arm = identities.get(line.foodLookupId)?.arm;

            return arm?.kind === 'root'
                ? [{ sortOrder: line.sortOrder, foodId: arm.foodId, foodOwnerId: privateFoodOwnerOf(arm) ?? null }]
                : [];
        });
        const first = evaluatePublicFoods({ ...state, lines: rootLines });

        if (first.allowed) {
            return [];
        }

        const nowPublic = await this.identities.publicAmong(caller, [
            ...new Set(first.lines.map((line) => line.foodId)),
        ]);
        const second = evaluatePublicFoods({
            ...state,
            lines: rootLines.map((line) => (nowPublic.has(line.foodId) ? { ...line, foodOwnerId: null } : line)),
        });

        if (!second.allowed) {
            throw privateFoodsOnPublicRecipe(second.lines);
        }

        return [...nowPublic];
    }

    /**
     * The LAST statement of a write that can leave a recipe public: ask the database, by its own rule, whether the
     * recipe now holds a private food. Any row aborts the write (its transaction rolls back). It backs the policy
     * against a binding that changed between the check and the write.
     *
     * ⛔ It judges the status and visibility of the row the write RETURNED, never the copy read before the transaction:
     * a set-visibility or publish that committed in between moved the row, and a check on the stale copy would let the
     * database's commit-time trigger be the first to notice, as a raw 500.
     *
     * @param tx - The write's open transaction.
     * @param written - The aggregate the write returned.
     * @throws {RecipeDomainError} `PRIVATE_FOODS_ON_PUBLIC_RECIPE`.
     * @sideEffect One read, and only for a published public recipe.
     */
    private async assertNoPrivateFoodLinesIn(tx: RecipeTx, written: RecipeAggregate): Promise<void> {
        const { id, status, visibility } = written.recipe;

        if (status !== RecipeStatus.PUBLISHED || visibility !== RecipeVisibility.PUBLIC) {
            return;
        }

        const [first, ...rest] = await this.dal.privateFoodLines(tx, id);

        if (first !== undefined) {
            throw privateFoodsOnPublicRecipe([first, ...rest]);
        }
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
     * derived from the signed token's roles (`isPremiumPrincipal` in `auth/principal.ts`).
     */
    public async create(
        principal: Principal,
        dto: CreateRecipeDto,
        caller: CallerToken | undefined,
        imported?: ImportedCreate,
    ): Promise<RecipeResponse> {
        // ── Provenance FIRST, then visibility ────────────────────────────────────────────────────
        // The order is the seam (ADR-0023): the provenance policy decides WHAT THE RECIPE IS, and C-004
        // then decides what visibility THAT THING may hold. Until 004-FR-024, `evaluateVisibility` was
        // handed the literal `USER_CREATED`, so the provenance a caller declared and the provenance its
        // visibility was judged against could not be the same fact.
        //
        // `scopes` ∪ `permissions` mirrors identity's `ScopesGuard` rule that a grant is satisfied by
        // EITHER list; both come from the token's SIGNED `public_metadata`.
        // ⛔ The bulk import is the ONE caller that states its provenance (ADR-0023's exception, this route only): the
        // cook's per-recipe statement set it, and the stored statement and citation back the label. Everything below
        // (visibility, the publish floor, the planner, the version row) is the SAME path an ordinary create takes.
        const provenanceDecision =
            imported === undefined
                ? evaluateProvenance({
                      declared: dto.source,
                      grantedScopes: [...principal.scopes, ...principal.permissions],
                  })
                : ({
                      allowed: true,
                      provenance: imported.provenance,
                      reason: 'The import’s per-recipe statement set the provenance.',
                  } as const);

        if (!provenanceDecision.allowed) {
            throw provenanceNotPermitted(provenanceDecision.reason, {
                requiredScope: provenanceDecision.requiredScope,
                sourceType: dto.source?.sourceType,
            });
        }

        const provenance = provenanceDecision.provenance;
        const requested = dto.visibility ?? RecipeVisibility.PUBLIC;
        const isPremium = isPremiumPrincipal(principal);
        const visibilityAsk = visibilityAskOf(principal, { sourceType: provenance.sourceType }, requested);
        // ADR-0073: only a free cook's private PUBLISHED recipe takes a slot, and THAT decision is made inside the write's transaction,
        // under the per-user lock, below. Every other request has no slot to lack, so it is judged here, before the planner,
        // exactly as it always was - a pure refusal must not cost a call to food. (A slot refusal does: it is only known
        // under the lock, after the planner has run. That is accepted: the cook out of slots pays one round trip per try.)
        // An ABSENT status means published, resolved ONCE here and written explicitly below, so the policy and the row
        // agree on what "published" means rather than the policy assuming the column default. It is resolved BEFORE the slot
        // question because a slot is a private PUBLISHED recipe (ADR-0073 section 12): a private draft holds none.
        const status = dto.status ?? RecipeStatus.PUBLISHED;
        const needsSlot = requiresPrivateSlotCheck({
            sourceType: provenance.sourceType,
            isPremium,
            before: undefined,
            after: { visibility: requested, status },
        });

        if (!needsSlot) {
            assertVisibilityAllowed(visibilityAsk, SLOT_NOT_NEEDED);
        }

        // ── Then what Publish needs (owner rulings 2026-10-13) ─────────────────────────────────────────
        // Judged before the planner, because a pure refusal must not cost a call to food.
        assertPublishable({
            status,
            sourceType: provenance.sourceType,
            cuisine: dto.cuisine ?? null,
            ingredientCount: dto.ingredients.length,
            stepCount: dto.steps.length,
        });

        // OUTSIDE the transaction: the plan reads the bindings and asks food for their names.
        const plan = await this.planner.plan(caller, dto.ingredients);
        // ADR-0029 section 4: a published public recipe holds no private food. Judged before the write, after recapture.
        const publicState = { status, visibility: requested };
        const nowPublicFoods = await this.publicFoodsGuard(
            caller,
            publicState,
            plan.inputs.map((line) => ({ foodLookupId: line.foodLookupId, sortOrder: line.sortOrder })),
            plan.identities,
        );

        // ⛔ The origins are matched to the planned lines BY POSITION, so a list of another length is a defect in the caller, and a
        // missing entry would silently read as "the cook chose this food" (`cook`) and drop the line from every worklist.
        if (imported !== undefined && imported.lineOrigins.length !== plan.inputs.length) {
            throw new Error(
                `imported.lineOrigins has ${String(imported.lineOrigins.length)} entries for ${String(plan.inputs.length)} planned lines`,
            );
        }

        // ⛔ ONE TRANSACTION: the recipe and its version row commit together or not at all (owner ruling
        // 2026-09-06). Everything above stays OUTSIDE — reads, policy and pure derivation — and so does
        // everything below, because a Postgres transaction must never be held across a network call.
        const aggregate = await this.dal.transaction(async (tx) => {
            // ⛔ ADR-0073: the per-user lock and the count are the FIRST statements of this transaction, and the verdict is
            // read from the number counted under that lock - a count taken before the transaction is the race the lock closes.
            if (needsSlot) {
                const standing = await this.slotStandingIn(tx, principal.userId, isPremium);

                assertVisibilityAllowed(visibilityAsk, standing);
            }

            // The author's byline (plan 2026-10-15-010 D8): the read model first, read INSIDE this transaction.
            const byline = await this.bylineIn(tx, principal);

            if (nowPublicFoods.length > 0) {
                await this.dal.clearPublicFoodOwners(tx, nowPublicFoods);
            }

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
                    // Publication status (W8-a.3), as resolved above: never left to the column default.
                    status,
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
                    // Denormalized byline (W8-a.2) — each half absent → its column stays NULL until the fan-out fills it.
                    ...bylineColumnsOf(byline),
                    // Who bound each line (ADR-0072 §5): a create has nothing stored, so the cook's own foods are `cook`, a
                    // line kept as written has no origin, and the import states its own.
                    ingredients: this.withBindings(
                        [],
                        plan.inputs,
                        plan.identities,
                        (index) => imported?.lineOrigins[index],
                    ),
                    steps: dto.steps.map(toStepInput),
                },
                tx,
            );

            // The import's claim of its item, in THIS transaction, so the claim and the recipe commit or vanish together.
            await imported?.afterWrite?.(tx, {
                recipeId: created.recipe.id,
                ingredients: created.ingredients,
                identities: plan.identities,
            });

            await this.recordSnapshotIn(tx, created, plan.identities, principal.userId, 'Created', byline);
            await this.assertNoPrivateFoodLinesIn(tx, created);

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
     *    return is the FIRST statement, before the dedup read, so a request never sent pays for nothing.
     *  - **⛔ A judgement already on record is not asked again (ADR-0071).** Before enqueueing, the verdict table
     *    is read by each request's key — the exact answer `alreadyRequested` approximates. It covers a line two
     *    recipes share, and a pasted line whose proposal the gate already judged. The read fails OPEN: on any
     *    error every request is sent, because a missed dedup costs a duplicate question, never a skipped check.
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

        // ADR-0071: no provenance is read here; the plan declares every line `unattributed`.
        const { requests: planned, unasked } = buildVerificationRequests({
            recipeId,
            lines: lines.map((row) => storedLineToVerifiable(row, identities)),
            alreadyRequested: previous.map((row) => storedLineToVerifiable(row, identities)),
            thresholds: PROVISIONAL_VERIFICATION_THRESHOLDS,
            requestedAt: new Date().toISOString(),
        });

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

        const requests = await this.withoutVerdictsOnRecord(recipeId, planned);

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
    }

    /**
     * Drop the requests whose judgement already has a verdict on record (ADR-0071).
     *
     * Fails OPEN: an unreadable verdict table sends everything, because a missed dedup costs a duplicate question
     * whose verdict write is idempotent by key, never a skipped check.
     *
     * @param recipeId - For the log line only.
     * @param requests - The plan's messages.
     * @returns The messages to send. @sideEffect One keyed read of `recipe_ingredient_verifications`.
     */
    private async withoutVerdictsOnRecord(
        recipeId: string,
        requests: readonly VerifyIngredientLineMessage[],
    ): Promise<readonly VerifyIngredientLineMessage[]> {
        if (requests.length === 0) {
            return requests;
        }

        return withoutVerdictsOnRecord(
            this.verdicts,
            requests,
            (message) => verificationKey(verifiedLineIdentityOfMessage(message), sha256Hex),
            (error) =>
                this.logger.warn(
                    `recipe ${recipeId}: verdict dedup read failed; asking about all ${String(requests.length)} line(s)`,
                    error instanceof Error ? error.stack : String(error),
                ),
        );
    }

    /**
     * Stamp each line with WHO BOUND it and WHICH imported line it came from (`bound_by`, `import_line_id`; ADR-0072 §5), by
     * the pure {@link resolveLineBindings} rule over the currently-stored lines.
     *
     * ⛔ "KEPT AS WRITTEN" IS DERIVED FROM THE BINDING'S ARM. A line kept as written still has a `food_lookup_id` (an
     * unresolved one), so feeding the rule raw ids would call it a food, and the first save would turn every such line into
     * `cook`. The arm is read from the identities this write's plan already derived; a stored line whose binding is not in
     * them is not among the incoming lines either, so it cannot match.
     *
     * @param stored - The recipe's persisted lines (none on a create).
     * @param resolved - The lines about to be persisted, in final order.
     * @param identities - The lines' identities by binding id, from this write's plan.
     * @param directiveAt - The save path's directive for the line at an index, if any.
     * @returns The same lines, each stating its origin. Pure.
     */
    private withBindings(
        stored: readonly IngredientRow[],
        resolved: readonly IngredientLineInput[],
        identities: LineIdentities,
        directiveAt: (index: number) => LineOriginDirective | undefined,
    ): IngredientLineInput[] {
        const isKeptAsWritten = (lookupId: string): boolean => identities.get(lookupId)?.arm.kind === 'unresolved';
        const storedBindings = stored.map((row): StoredBinding => {
            const boundBy = isBoundBy(row.boundBy) ? row.boundBy : null;

            return isKeptAsWritten(row.foodLookupId)
                ? {
                      foodLookupId: undefined,
                      keptLookupId: row.foodLookupId,
                      boundBy: null,
                      importLineId: row.importLineId,
                  }
                : { foodLookupId: row.foodLookupId, boundBy, importLineId: row.importLineId };
        });
        const incoming = resolved.map((line, index): DirectedBinding => {
            const directive = directiveAt(index);
            const identity = isKeptAsWritten(line.foodLookupId)
                ? { foodLookupId: undefined, keptLookupId: line.foodLookupId }
                : { foodLookupId: line.foodLookupId };

            return { ...identity, importLineId: null, ...(directive === undefined ? {} : { directive }) };
        });
        const origins = resolveLineBindings(storedBindings, incoming);

        return resolved.map((line, index) => ({
            ...line,
            boundBy: origins[index]?.boundBy ?? null,
            importLineId: origins[index]?.importLineId ?? null,
        }));
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
                    ...(row.holdsPrivateFood !== undefined ? { holdsPrivateFood: row.holdsPrivateFood } : {}),
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
        options: UpdateOptions = {},
    ): Promise<RecipeResponse> {
        const ownerId = principal.userId;
        const existing = await this.findEditableAggregate(ownerId, id, dto.expectedVersion, caller);

        // What Publish needs (owner rulings 2026-10-13), judged on EVERY update against the state the write leaves: the
        // patch's value where it carries one, the stored value where it does not. Not only when the body says
        // `status: 'published'` — a "Save changes" PATCH sends no status, and judging only explicit publishes is what
        // let one empty a published recipe. The compare-and-swap on `expectedVersion` below makes judging against
        // `existing` safe: a write that lands in between is a 409, never a stale pass. Before the planner, so a pure
        // refusal costs no call to food.
        assertPublishable({
            status: dto.status ?? recipeStatusSchema.parse(existing.recipe.status),
            sourceType: recipeSourceTypeSchema.parse(existing.recipe.sourceType),
            cuisine: dto.cuisine === undefined ? existing.recipe.cuisine : dto.cuisine,
            ingredientCount: dto.ingredients?.length ?? existing.ingredients.length,
            stepCount: dto.steps?.length ?? existing.steps.length,
        });

        // Plan replacement lines only when the patch carries them (absent → links untouched).
        // ⛔ The resolved lines are then handed the TRANSCRIPTION the stored lines already hold. `PATCH`
        //    cannot carry a `sourceLine` (create-only, ADR-0023's shape) and `replaceForRecipe` swaps the
        //    whole set, so without this a title edit would destroy every source line on an imported recipe —
        //    and BOTH shipped clients send `ingredients` on every save (`toUpdateRecipeInput` spreads
        //    `toCreateRecipeInput`, which always emits the array), so "a metadata-only PATCH preserves them"
        //    describes a request no app makes. The rule is `domain/transcriptionCarryForward.ts`; it is applied
        //    HERE because this is the only layer holding both the stored aggregate and the resolved lines.
        const plan = dto.ingredients !== undefined ? await this.planner.plan(caller, dto.ingredients) : undefined;
        // …and the ORIGIN of each line (ADR-0072 §5): the food's own, carried by identity; a changed food is the cook's.
        const ingredients =
            plan === undefined
                ? undefined
                : this.withBindings(
                      existing.ingredients,
                      this.withCarriedTranscription(existing.ingredients, plan.inputs),
                      plan.identities,
                      (index) => options.lineOrigins?.get(index),
                  );
        // The version snapshot needs every line's identity. A patch without lines keeps the stored ones, whose
        // identities are read here — OUTSIDE the transaction, because it asks food.
        const identities =
            plan?.identities ??
            (await this.identities.identify(
                caller,
                existing.ingredients.map((row) => row.foodLookupId),
                'postCommit',
            ));

        // ADR-0029 section 4: judged on the state the write leaves, against the lines it leaves (the patch's, else the
        // stored ones), after recapture. The visibility an update leaves is the stored one: only set-visibility moves it.
        const publicState = {
            status: dto.status ?? recipeStatusSchema.parse(existing.recipe.status),
            visibility: existing.recipe.visibility,
        };
        const nowPublicFoods = await this.publicFoodsGuard(
            caller,
            publicState,
            plan !== undefined
                ? plan.inputs.map((line) => ({ foodLookupId: line.foodLookupId, sortOrder: line.sortOrder }))
                : existing.ingredients.map((row) => ({ foodLookupId: row.foodLookupId, sortOrder: row.sortOrder })),
            identities,
        );

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

        // Whether this write could take a slot: only publishing a DRAFT can (a published recipe already holds or never held
        // one, and set-visibility counts its own moves). The precise verdict needs the row's visibility, read under the lock.
        const sourceType = recipeSourceTypeSchema.parse(existing.recipe.sourceType);
        const isPremium = isPremiumPrincipal(principal);
        const existingStatus = recipeStatusSchema.parse(existing.recipe.status);
        const afterStatus = dto.status ?? existingStatus;
        const publishesDraft = existingStatus === RecipeStatus.DRAFT && afterStatus === RecipeStatus.PUBLISHED;
        const takesSlotLock = publishesDraft && slotRuleApplies({ isPremium });

        // ⛔ ONE TRANSACTION, and the CAS miss must LEAVE it before it is diagnosed. `raiseVersionConflict`
        // calls `dal.readConflict`, which opens its own transaction AND issues
        // `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` — a second pooled connection, and a statement
        // Postgres rejects once one has already run. So the callback returns `undefined` and the 409 is
        // raised outside; nothing was written, so committing an empty transaction is correct and cheaper
        // than forcing a rollback.
        const updated = await this.dal.transaction(async (tx) => {
            // ⛔ ADR-0073 sections 3 and 12: publishing a draft is where it may come to hold a slot (a private draft holds
            // none; the same recipe published does). The per-user lock and the count are the FIRST statements of the
            // transaction; the row's facts are read FOR UPDATE below, after the byline (see the order note there).
            const counted = takesSlotLock ? await this.slotStandingIn(tx, ownerId, isPremium) : undefined;

            // The version's attribution: the editor's byline, read-model-first inside this transaction (plan
            // 2026-10-15-010 D8). Read BEFORE the recipe row is written, as `create` and `clone` do: the handle-sync
            // fan-out locks `author_handles` and then the cook's recipes, so the opposite order here can deadlock. The
            // order is therefore slot lock, byline, row lock (below), write - and set-visibility takes the slot lock before
            // the row lock too, so the two never wait on each other the other way round.
            const editor = await this.bylineIn(tx, principal);

            if (publishesDraft) {
                // The visibility NOW, under the lock: set-visibility does not bump the version, so the CAS below cannot see a
                // flip made after `existing` was read.
                const current = await this.dal.lockSlotFacts(tx, id);

                if (current === undefined) {
                    return undefined;
                }

                if (current.visibility === RecipeVisibility.PRIVATE) {
                    // Publishing a private draft is a move to private like any other, so it meets the SAME C-004 policy (the
                    // only door a private `imported_public` recipe has is Premium plus a substantive edit - a slot never makes
                    // one private, ADR-0073 section 6) with the slot fact counted under the lock where a slot can matter.
                    const takesSlot = requiresPrivateSlotCheck({
                        sourceType,
                        isPremium,
                        before: { visibility: current.visibility, status: existingStatus },
                        after: { visibility: current.visibility, status: afterStatus },
                    });

                    if (takesSlot && counted === undefined) {
                        // Unreachable: a move that takes a slot is a draft being published by a cook the slot rule applies to,
                        // which is exactly when the lock was taken. Fail CLOSED rather than let a missing count allow it.
                        throw new Error('A private draft was published without the per-user slot lock being taken.');
                    }

                    assertVisibilityAllowed(
                        visibilityAskOf(principal, { sourceType }, RecipeVisibility.PRIVATE),
                        takesSlot && counted !== undefined ? counted : SLOT_NOT_NEEDED,
                    );
                }
            }

            if (nowPublicFoods.length > 0) {
                await this.dal.clearPublicFoodOwners(tx, nowPublicFoods);
            }

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

            await this.recordSnapshotIn(
                tx,
                result,
                identities,
                ownerId,
                options.snapshot?.changeSummary ?? 'Updated',
                editor,
                options.snapshot?.baseVersion,
            );
            await this.assertNoPrivateFoodLinesIn(tx, result);

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
     * `visibility` set to the C-004 clone default for the source type, and `status` `draft` (owner 2026-10-13: it is
     * published only when the cook edits it and presses Publish). The ORIGINAL is never mutated.
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

        const sourceType = source.recipe.sourceType;
        // An imported source's attribution is kept verbatim. A user_created original has none, and none is
        // invented: provenance is `clonedFromId`, and a stored "Cloned from <owner id>" put a raw user id on
        // Discover cards and outlived the original author's erasure (W-03).
        const attribution = source.recipe.sourceAttribution ?? undefined;

        // U13 (R20), plan 002 R9: the clone KEEPS every binding, including one to another author's private food,
        // which renders as unavailable to the cloner. Its identities are read with the CLONER's credential, and the
        // search text and the first version store only shareable names, so the clone publishes no private name.
        const identities = await this.identities.identify(
            caller,
            source.ingredients.map((row) => row.foodLookupId),
            'postCommit',
        );
        const hiddenCount = countHiddenFromViewer(source.ingredients, identities, ownerId);

        // ADR-0073 section 12: a clone is always written as a DRAFT (below), and a draft holds no slot, so a clone is never
        // counted or refused for slots - whatever visibility it lands with. The slot is taken when the cook publishes it
        // (`update`).
        const cloneVisibility = defaultCloneVisibility(sourceType, principal, source.recipe.visibility);

        // ⛔ ONE TRANSACTION, exactly as `create` — the clone and its first version row commit together.
        const created = await this.dal.transaction(async (tx) => {
            // The CLONER's byline: the clone is theirs, so they are its author and its first version's editor.
            const byline = await this.bylineIn(tx, principal);
            const cloned = await this.dal.create(
                {
                    ownerId,
                    title: source.recipe.title,
                    ...(source.recipe.description !== null ? { description: source.recipe.description } : {}),
                    ...(source.recipe.cuisine !== null ? { cuisine: source.recipe.cuisine } : {}),
                    visibility: cloneVisibility,
                    // Owner 2026-10-13: a copy is a DRAFT until the cook makes a real edit and publishes. It is never
                    // born published, whatever the source's status was — and, being a never-published draft, it
                    // records no version of its own yet (ADR-0058).
                    status: RecipeStatus.DRAFT,
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
                    ...bylineColumnsOf(byline),
                    ingredientNamesText: ingredientNamesText(source.ingredients, identities),
                    ingredients: source.ingredients.map(toClonedLineInput),
                    steps: source.steps.map(toStepInputFromRow),
                },
                tx,
            );

            await this.recordSnapshotIn(tx, cloned, identities, ownerId, `Cloned from ${source.recipe.id}`, byline);

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
     * principal's roles (`isPremiumPrincipal` in `auth/principal.ts`). A
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

        const isPremium = isPremiumPrincipal(principal);
        const sourceType = existing.recipe.sourceType;
        const visibilityAsk = visibilityAskOf(principal, { sourceType }, visibility);
        // The row's facts are only known for certain UNDER the lock (set-visibility does not bump the version, and another
        // request may publish a draft in between), so the lock is taken whenever the slot rule could apply to a move to
        // private, and the precise verdict is made from the facts read under it.
        const mayNeedSlot = visibility === RecipeVisibility.PRIVATE && slotRuleApplies({ isPremium });

        // ADR-0029 section 4: making a published recipe public is refused while it holds a private food. Only that move
        // costs a read of the bindings and a call to food.
        const publicState = { status: recipeStatusSchema.parse(existing.recipe.status), visibility };
        const nowPublicFoods =
            publicState.status === RecipeStatus.PUBLISHED && visibility === RecipeVisibility.PUBLIC
                ? await this.publicFoodsGuard(
                      caller,
                      publicState,
                      existing.ingredients.map((row) => ({ foodLookupId: row.foodLookupId, sortOrder: row.sortOrder })),
                      await this.identities.identify(
                          caller,
                          existing.ingredients.map((row) => row.foodLookupId),
                          'read',
                      ),
                  )
                : [];

        // ONE TRANSACTION (ADR-0073): set-visibility used to be a single UPDATE; it now needs the per-user lock, the count
        // and the write to be one unit, or two requests racing at 49 both pass.
        const updated = await this.dal.transaction(async (tx) => {
            let standing: PrivateSlotStanding = SLOT_NOT_NEEDED;

            if (mayNeedSlot) {
                const counted = await this.slotStandingIn(tx, principal.userId, isPremium);
                const current = await this.dal.lockSlotFacts(tx, id);

                if (current === undefined) {
                    return undefined;
                }

                // A recipe that already holds its slot (private and published) needs none: a downgraded cook holding 60 must
                // not be refused a recipe they already keep private, and a second concurrent request for it must not be
                // counted twice. A DRAFT holds none, so making it private needs none either - its slot is taken on publish.
                standing = requiresPrivateSlotCheck({
                    sourceType,
                    isPremium,
                    before: current,
                    after: { visibility, status: current.status },
                })
                    ? counted
                    : SLOT_NOT_NEEDED;
            }

            assertVisibilityAllowed(visibilityAsk, standing);

            if (nowPublicFoods.length > 0) {
                await this.dal.clearPublicFoodOwners(tx, nowPublicFoods);
            }

            const written = await this.dal.setVisibility(id, visibility, tx);

            if (written !== undefined) {
                await this.assertNoPrivateFoodLinesIn(tx, written);
            }

            return written;
        });

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

    /**
     * The caller's private-slot standing for DISPLAY (ADR-0073): how many they hold and what they get.
     *
     * Counted WITHOUT the per-user lock - a stale-by-a-moment number is harmless on a screen, and a read that took the lock
     * would serialise the cook's own writes behind a label. ⛔ Never decide a write from this; every write counts again under
     * the lock in its own transaction.
     *
     * @param principal - The verified caller (Premium is read from the signed token).
     * @returns `unlimited` for Premium (no count is taken), else the live count and the limit.
     */
    public async getPrivateSlotUsage(principal: Principal): Promise<PrivateSlotUsage> {
        const allowance = privateSlotAllowanceOf({ isPremium: isPremiumPrincipal(principal) });

        if (allowance.kind === 'unlimited') {
            return { kind: 'unlimited' };
        }

        return { kind: 'limited', used: await this.dal.countPrivateSlots(principal.userId), limit: allowance.limit };
    }

    /**
     * A cook's private-slot standing, read UNDER the per-user lock (ADR-0073).
     *
     * ⛔ Call it as the FIRST statement of the transaction that writes the recipe, and judge from what it returns inside
     * that same transaction. Premium never counts, so it takes no lock and no count.
     *
     * @param tx - The write's open transaction.
     * @param ownerId - The cook.
     * @param isPremium - Whether the cook holds Premium (from the signed token).
     * @returns Whether one more private recipe fits and, when it does not, the count and the limit.
     * @sideEffect Takes a transaction-scoped advisory lock keyed by the cook (free cooks only).
     */
    private async slotStandingIn(tx: RecipeTx, ownerId: string, isPremium: boolean): Promise<PrivateSlotStanding> {
        const allowance = privateSlotAllowanceOf({ isPremium });

        if (allowance.kind === 'unlimited') {
            return SLOT_NOT_NEEDED;
        }

        return privateSlotStandingOf(allowance, await this.dal.lockAndCountPrivateSlots(tx, ownerId));
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
