/**
 * T028 — `IngredientsService`: the ingredient picker's business logic over BINDINGS (plan 002, migration 0051).
 *
 * A recipe line binds to a `food_lookups` row: a root food, a variant, or the record of a lookup that did not
 * resolve. Every bind lands on the LIVE END food answered (curated U9): a picked or resolved food that food has
 * forwarded binds its forward's end, root or variant. This service creates and advances those bindings, orchestrating the {@link FoodLookupsDal}
 * repository, the source-agnostic food service (through the per-caller client factory and the refs gateway),
 * and the resolution cascade. The recipe database stores no food names: a bound binding's name always comes
 * from food, asked as the caller.
 *
 * The rules each path keeps, and the requirement behind each:
 *  - **A pick binds only after food's authorship-checked answer (R51).** `addByFoodId`, a cascade hit and a
 *    settle all ask the refs resolver, which applies food's authorship policy; a food the caller may not see
 *    answers `absent`, so it cannot be bound, and a private food's owner is recorded only when the resolver
 *    showed it to its author. Food's unauthenticated status read is never used to decide ownership.
 *  - **Every failure keeps its reason (R1 to R3).** An unresolved add records why — awaiting the source, several
 *    candidates, no source has it, sources errored, the cascade exhausted or unavailable — with the tiers
 *    consulted, through `failureOutcome`'s policy.
 *  - **Only a food-service fact frees a shared failure (R13).** Settling needs a `ResolvedHandle`, which only
 *    food's answer about the failure's own pending food or phrase produces.
 *  - **A refresh never re-runs the cascade (R20).** A personal correction must not move other cooks' lines, and
 *    a shared failure's lines belong to many cooks.
 *
 * **Every food call is made AS THE CALLER** (issue #120), threaded explicitly as the first parameter;
 * `undefined` means the request carried no bearer, and no other credential is substituted.
 *
 * @pattern Application Service — over the bindings repository, the food gateways and the admission and failure
 *   policies
 * @implements FR-007 FR-007a FR-047
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { Ingredient } from '@kitchensink/recipe-core';
import {
    normalizedIngredientKey,
    type NormalizedIngredientKey,
} from '@kitchensink/recipe-core/resolution/normalized-key';
import { marginBandOf, queryShapeOf } from '@kitchensink/recipe-core/resolution/band-policy';
import { RANKER_VERSION } from '@kitchensink/recipe-core/resolution/ranking-tiers';

import type { CallerToken } from '../auth/CallerToken.js';
import { apiError } from '../common/apiError.js';
import {
    foodRefKey,
    foodRefOf,
    type BoundArm,
    type FoodLookupArm,
    type FoodRef,
    type RootArm,
    type UnresolvedArm,
} from '../database/schema/foodLookupArm.js';
import { foodNotAdmissible, ingredientNotFound } from '../recipes/recipe.error.js';
import { FoodLookupsDal } from './dal/foodLookups.dal.js';
import {
    admitResolvedRef,
    isAdmission,
    isOpenFailure,
    resolvedHandleOf,
    type FoodAdmission,
    type FreeingEvidence,
} from './domain/foodAdmission.js';
import type { FoodRefAnswer } from './domain/foodRefAnswer.js';
import {
    declaredFailure,
    failureOf,
    mergeAttempt,
    type CascadeFinding,
    type FoodAddAnswer,
} from './domain/failureOutcome.js';
import { deriveIngredientLineIdentity } from './domain/ingredientLineIdentity.js';
import type { CanonicalIngredientName } from './domain/ingredientName.js';
import { FoodCatalogGateway } from './foodCatalog.gateway.js';
import { FoodRefsGateway } from './foodRefs.gateway.js';
import { FoodServiceClients } from './FoodServiceClients.factory.js';
import { toIngredient } from './ingredientProjection.js';
import { identifyArmsThrough } from './lineIdentity.reader.js';
import type { FoodReferencesResponse } from './ingredients.schema.js';
import type { IngredientResolutionsDal } from './resolution/ingredientResolutions.dal.js';
import type { ResolutionBandsDal } from './resolution/resolutionBands.dal.js';
import { isCascadeTierId, runResolutionCascade, type ResolutionTier } from './resolution/resolutionCascade.js';

/** Search hits when a caller names no limit. */
const DEFAULT_SEARCH_LIMIT = 10;

/** The most hits a caller may ask for. */
const MAX_SEARCH_LIMIT = 50;

/**
 * Clamp a requested limit into `[1, MAX_SEARCH_LIMIT]`, defaulting when absent or invalid.
 *
 * @param limit - The caller's limit.
 * @returns The clamped limit. Pure.
 */
function clampLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit)) {
        return DEFAULT_SEARCH_LIMIT;
    }

    return Math.min(Math.max(Math.trunc(limit), 1), MAX_SEARCH_LIMIT);
}

/**
 * What the cascade did for one phrase: bound a food, or concluded without one.
 */
type CascadeResult =
    | { readonly kind: 'bound'; readonly ingredient: Ingredient }
    | { readonly kind: 'miss'; readonly finding: CascadeFinding };

/**
 * A short, operator-only description of why food did not answer. It names the error class and, when there is
 * one, the HTTP status — never a response body, which could carry anything.
 *
 * @param error - What the food call threw.
 * @returns The detail. Pure.
 */
function unreachableDetail(error: unknown): string {
    if (!(error instanceof Error)) {
        return 'food add-by-name failed';
    }

    const status = (error as { status?: unknown }).status;

    return typeof status === 'number' ? `${error.name} ${String(status)}` : error.name;
}

/**
 * The normalized key a canonical name converges on.
 *
 * @param name - A canonical name.
 * @returns Its key.
 * @throws {BadRequestException} when the name has no visible content — which a canonical name never has, so
 *   this is the type's promise checked rather than assumed. Pure.
 */
function keyOf(name: CanonicalIngredientName): NormalizedIngredientKey {
    const key = normalizedIngredientKey(name);

    if (key === undefined) {
        throw new BadRequestException('The ingredient name has no visible content.');
    }

    return key;
}

@Injectable()
export class IngredientsService {
    /** One logger for the cascade's tier failures — a degraded tier must be visible, never silent. */
    private readonly logger = new Logger(IngredientsService.name);

    /**
     * @param lookups - The bindings repository.
     * @param foodClients - The per-caller food-service client factory.
     * @param catalog - The typeahead's short-timeout, no-throw gateway.
     * @param refs - Food's authorship-checked answer about a food reference (R51).
     * @param resolutionTiers - The ORDERED resolution cascade (plan U10). An EMPTY array is a supported state.
     * @param resolutions - The cascade's provenance events.
     * @param bands - Band authority, for a ranked resolution's epoch.
     */
    public constructor(
        private readonly lookups: FoodLookupsDal,
        private readonly foodClients: FoodServiceClients,
        private readonly catalog: FoodCatalogGateway,
        private readonly refs: FoodRefsGateway,
        // ⛔ REQUIRED, all three: a collaborator that defaults to absent is how a feature ships silently disabled
        // past a green suite. A fixture that does not care passes a double.
        private readonly resolutionTiers: readonly ResolutionTier[],
        private readonly resolutions: IngredientResolutionsDal,
        private readonly bands: Pick<ResolutionBandsDal, 'authorityFor'>,
    ) {}

    /**
     * `GET /api/v1/ingredients/food-references/{foodId}` (plan U18, R22) — who references this food. `total`
     * spans all users; ids are the CALLER's own recipes only.
     *
     * @param callerId - The authenticated caller.
     * @param foodId - The food id.
     * @returns The reference count and the caller's own referencing recipe ids.
     * @sideEffect One grouped read.
     */
    public async foodReferences(callerId: string, foodId: string): Promise<FoodReferencesResponse> {
        const references = await this.lookups.recipesReferencingFood(foodId);

        return {
            total: references.length,
            ownRecipeIds: references.filter((row) => row.ownerId === callerId).map((row) => row.recipeId),
        };
    }

    /**
     * `GET /api/v1/ingredients/search` — the foods among food's catalog hits that already have a binding the
     * caller may see, named from food. Every entry carries its `foodId`, which the recipe filter keys on (R45).
     *
     * Every result is a food hit, so food down must not read as "no match": `unavailable` throws. A catalog
     * switched off (`disabled`) is configuration, not an outage, and answers an empty list.
     *
     * @param caller - The caller's credential, forwarded to food.
     * @param query - The raw query (trimmed here).
     * @param callerUserId - The caller, for the private-binding predicate (R20).
     * @param limit - Optional max hits (clamped).
     * @returns The bound foods, in food's rank order.
     * @throws {HttpException} `502 SOURCE_UNAVAILABLE` when food could not be asked.
     * @sideEffect One food catalog search and one bindings read.
     */
    public async search(
        caller: CallerToken | undefined,
        query: string,
        callerUserId?: string,
        limit?: number,
    ): Promise<Ingredient[]> {
        const { hits, availability } = await this.catalog.search(caller, query.trim(), clampLimit(limit));

        if (availability === 'unavailable') {
            throw apiError('SOURCE_UNAVAILABLE', 'The ingredient source did not answer.');
        }

        const bound = await this.lookups.findBoundRootsByFoodIds(
            hits.map((hit) => hit.foodId),
            callerUserId,
        );

        return hits.flatMap((hit) => {
            const arm = bound.get(hit.foodId);

            return arm === undefined ? [] : [this.named(arm, hit.name)];
        });
    }

    /**
     * `POST /api/v1/ingredients/by-food` — bind a ROOT food the caller picked. See {@link addByRef}.
     *
     * @param caller - The caller's credential.
     * @param foodId - The root food id (trimmed here).
     * @param callerUserId - The caller, recorded as owner of their own private food.
     * @returns The bound ingredient, `RESOLVED`.
     * @throws {RecipeError} `UNKNOWN_INGREDIENT` (→ 400) when food will not let the food be bound.
     * @throws {HttpException} `502 SOURCE_UNAVAILABLE` when food cannot be asked.
     * @sideEffect One food-service request, then at most one binding write.
     */
    public async addByFoodId(
        caller: CallerToken | undefined,
        foodId: string,
        callerUserId?: string,
    ): Promise<Ingredient> {
        return this.addByRef(caller, { kind: 'root', id: foodId.trim() }, callerUserId);
    }

    /**
     * `POST /api/v1/ingredients/by-food-variant` — bind a VARIANT the caller picked (curated U9, R20, R22). See
     * {@link addByRef}.
     *
     * @param caller - The caller's credential.
     * @param foodVariantId - The variant id (trimmed here).
     * @param callerUserId - The caller.
     * @returns The bound ingredient, `RESOLVED`, carrying its live root and the variant's parts.
     * @throws {RecipeError} `UNKNOWN_INGREDIENT` (→ 400) when food will not let the food be bound.
     * @throws {HttpException} `502 SOURCE_UNAVAILABLE` when food cannot be asked.
     * @sideEffect One food-service request, then at most one binding write.
     */
    public async addByFoodVariantId(
        caller: CallerToken | undefined,
        foodVariantId: string,
        callerUserId?: string,
    ): Promise<Ingredient> {
        return this.addByRef(caller, { kind: 'variant', id: foodVariantId.trim() }, callerUserId);
    }

    /**
     * Bind a food the caller picked, by its ref.
     *
     * ⛔ Bound only after food's authorship-checked answer (R51): a food the caller may not see, one not yet
     * resolved, or one with no usable name is refused, and nothing is written. What is bound is the LIVE END food's
     * answer names, never the id asked about.
     *
     * @param caller - The caller's credential.
     * @param ref - The root or variant the caller picked.
     * @param callerUserId - The caller, recorded as owner of their own private food.
     * @returns The bound ingredient, `RESOLVED`.
     * @throws {RecipeError} `UNKNOWN_INGREDIENT` (→ 400) when food will not let the food be bound.
     * @throws {HttpException} `502 SOURCE_UNAVAILABLE` when food cannot be asked.
     * @sideEffect One food-service request, then at most one binding write.
     */
    public async addByRef(caller: CallerToken | undefined, ref: FoodRef, callerUserId?: string): Promise<Ingredient> {
        const answer = await this.refs.resolveForBind(caller, ref);
        const admission = admitResolvedRef(answer, callerUserId);

        if (!isAdmission(admission)) {
            throw foodNotAdmissible(ref.id, admission.refused);
        }

        return this.bind(admission);
    }

    /**
     * `POST /api/v1/ingredients/by-name` — the picker's and the cookbook importer's add path.
     *
     * The cascade is consulted first (plan U10); a hit binds the mapped food through the same admission as a
     * pick, and a mapping whose food is no longer bindable falls through rather than failing. On a miss, food is
     * asked to add the phrase: a `RESOLVED` answer is bound (and frees the failure this phrase converged on),
     * any other answer — or no answer — is recorded as a failure with its reason. A phrase whose failure a settle
     * already freed is answered with the settle's target.
     *
     * @param caller - The caller's credential.
     * @param name - The display name, already canonical.
     * @param userId - The caller, or `undefined` for an unattended import (R22).
     * @returns The binding the line should hold.
     * @throws {HttpException} `502 SOURCE_UNAVAILABLE` when food resolved the phrase but its bind check cannot ask food.
     * @sideEffect Runs the cascade, calls food, and writes a binding or a failure record.
     */
    public async addByName(
        caller: CallerToken | undefined,
        name: CanonicalIngredientName,
        userId?: string,
    ): Promise<Ingredient> {
        const key = keyOf(name);
        const cascade = await this.resolveThroughCascade(caller, name, key, userId);

        if (cascade.kind === 'bound') {
            return cascade.ingredient;
        }

        return this.askFoodByName(caller, name, key, cascade.finding, userId);
    }

    /**
     * `POST /api/v1/ingredients` — a cook's declared name: a substance they ask for as written. It never
     * converges with another cook's declaration and is never retried.
     *
     * @param name - The display name, already canonical.
     * @returns The user-entered ingredient.
     * @sideEffect Inserts a failure record and its binding.
     */
    public async createFreeform(name: CanonicalIngredientName): Promise<Ingredient> {
        const arm = await this.lookups.recordFailure(declaredFailure(name, keyOf(name)));

        return toIngredient(deriveIngredientLineIdentity(arm, new Map()));
    }

    /**
     * `GET /api/v1/ingredients/{id}/status` — the poll.
     *
     * - A bound binding answers with food's current name (404 when food no longer shows it to the caller).
     * - A declared name asks food nothing.
     * - A settled failure answers with the settle's target, and asks food nothing about its own handle or phrase.
     * - A failure with a handle asks food about that handle: a `RESOLVED` answer settles every line on the
     *   failure and answers with the BOUND binding's id, which the client adopts; any other answer records the
     *   attempt and its new reason.
     * - A failure with no handle re-asks food by name. ⛔ It never re-runs the cascade (R20).
     *
     * @param caller - The caller's credential.
     * @param id - The binding id.
     * @param callerUserId - The caller.
     * @returns The binding the line should now hold.
     * @throws {RecipeError} `RECIPE_NOT_FOUND` (→ 404) for an unknown binding, or a bound food that food no longer
     *   shows the caller.
     * @throws {HttpException} `502 SOURCE_UNAVAILABLE` when food cannot be asked about a handle or a bound food, or
     *   when a failure with no handle is re-asked by name and food resolves it but its bind check cannot ask food.
     * @sideEffect Calls food; may settle lines or record an attempt.
     */
    public async refreshStatus(
        caller: CallerToken | undefined,
        id: string,
        callerUserId?: string,
    ): Promise<Ingredient> {
        const arm = await this.requireArm(id);

        if (arm.kind !== 'unresolved') {
            return this.namedByFood(caller, arm);
        }

        const { failure } = arm;

        // A declared name asks food nothing, and a settle is final: a closed failure is answered, never re-asked
        // about its old handle or phrase.
        if (!isOpenFailure(failure)) {
            return this.failureAnswer(caller, arm);
        }

        if (failure.foodHandleId === null) {
            return this.askFoodByName(
                caller,
                failure.name,
                failure.normalizedKey,
                { kind: 'exhausted', consulted: failure.tiersConsulted, unavailable: failure.tiersUnavailable },
                callerUserId,
                arm,
            );
        }

        const handle = failure.foodHandleId;
        const answer = await this.refs.resolveForBind(caller, { kind: 'root', id: handle });
        const settled = await this.settle(arm, { kind: 'handle', foodId: handle, answer });

        if (settled !== undefined) {
            return settled;
        }

        return this.recordOutcome(caller, arm, this.addAnswerOf(handle, answer));
    }

    /**
     * Bind an admitted food and project it for the picker.
     *
     * @param admission - Proof the food may be bound.
     * @returns The bound ingredient.
     * @sideEffect Finds or creates the food's binding.
     */
    private async bind(admission: FoodAdmission): Promise<Ingredient> {
        return this.admitted(await this.lookups.findOrCreateBound(admission), admission);
    }

    /**
     * Project a binding an admission just found or created, under the admission's name and food.
     *
     * @param arm - The binding.
     * @param admission - Food's answer it was admitted on.
     * @returns The picker's ingredient. Pure.
     */
    private admitted(arm: BoundArm, admission: FoodAdmission): Ingredient {
        return toIngredient({ arm, name: admission.name, presence: 'present', food: admission.food });
    }

    /**
     * Project a bound binding under a name food just gave.
     *
     * @param arm - The binding.
     * @param name - Food's name for it.
     * @returns The picker's ingredient. Pure.
     */
    private named(arm: RootArm, name: string): Ingredient {
        return toIngredient({ arm, name, presence: 'present', food: { rootId: arm.foodId } });
    }

    /**
     * Answer a bound binding under food's current name for the caller.
     *
     * @param caller - The caller's credential.
     * @param arm - The bound binding.
     * @returns The picker's ingredient.
     * @throws {RecipeError} `RECIPE_NOT_FOUND` when food no longer shows the food to the caller.
     * @sideEffect One food request.
     */
    private async namedByFood(
        caller: CallerToken | undefined,
        arm: Exclude<FoodLookupArm, UnresolvedArm>,
    ): Promise<Ingredient> {
        const ref = foodRefOf(arm);

        if (ref === undefined) {
            throw ingredientNotFound(arm.lookupId);
        }

        const answer = await this.refs.resolveForBind(caller, ref);
        const identity = deriveIngredientLineIdentity(arm, new Map([[foodRefKey(ref), answer]]));

        if (identity.name === undefined) {
            throw ingredientNotFound(arm.lookupId);
        }

        return toIngredient(identity);
    }

    /**
     * Ask food to add a phrase by name, and bind or record what it says.
     *
     * @param caller - The caller's credential; without one, food is not asked.
     * @param name - The phrase.
     * @param key - Its normalized key.
     * @param finding - What the cascade concluded.
     * @param userId - The caller.
     * @param existing - The failure this re-asks for, on a refresh; absent on a first add.
     * @returns The binding the line should hold.
     * @sideEffect Calls food; binds, settles or records.
     */
    private async askFoodByName(
        caller: CallerToken | undefined,
        name: string,
        key: string,
        finding: CascadeFinding,
        userId: string | undefined,
        existing?: UnresolvedArm,
    ): Promise<Ingredient> {
        const food = await this.foodAddAnswer(caller, name);

        if (food.kind === 'resolved') {
            const answer = await this.refs.resolveForBind(caller, { kind: 'root', id: food.foodId });
            const admission = admitResolvedRef(answer, userId);

            if (isAdmission(admission)) {
                const bound = await this.lookups.findOrCreateBound(admission);
                const converged = existing ?? (await this.lookups.findConvergedFailure(key));

                if (converged !== undefined) {
                    await this.settleWith(converged, bound, {
                        kind: 'name',
                        normalizedKey: key,
                        foodId: food.foodId,
                        answer,
                    });
                }

                return this.admitted(bound, admission);
            }

            // Food resolved the phrase to a food this caller cannot bind (no usable name, or not shown to them).
            // That is food's answer that it has nothing bindable under this name.
            return this.recordNew(
                caller,
                name,
                key,
                finding,
                { kind: 'answered', foodId: food.foodId, status: 'NOT_FOUND' },
                existing,
            );
        }

        return this.recordNew(caller, name, key, finding, food, existing);
    }

    /**
     * Ask food to add a phrase, as the caller.
     *
     * @param caller - The caller's credential; without one, food is not asked.
     * @param name - The phrase.
     * @returns Food's answer: resolved to a food, a failure answer, not asked, or unreachable.
     * @sideEffect One food request when there is a caller.
     */
    private async foodAddAnswer(
        caller: CallerToken | undefined,
        name: string,
    ): Promise<FoodAddAnswer | { readonly kind: 'resolved'; readonly foodId: string }> {
        if (caller === undefined) {
            return { kind: 'notAsked' };
        }

        try {
            const added = await this.foodClients.standard(caller).addByName(name);

            return added.status === 'RESOLVED'
                ? { kind: 'resolved', foodId: added.id }
                : { kind: 'answered', foodId: added.id, status: added.status };
        } catch (error) {
            this.logger.warn('food add-by-name did not answer; recording the attempt as sources_errored', {
                reason: unreachableDetail(error),
            });

            return { kind: 'unreachable', detail: unreachableDetail(error) };
        }
    }

    /**
     * Record a failure for a phrase: a new record on a first add, or a merged attempt on a refresh.
     *
     * @sideEffect Inserts or updates a failure record.
     */
    private async recordNew(
        caller: CallerToken | undefined,
        name: string,
        key: string,
        finding: CascadeFinding,
        food: FoodAddAnswer,
        existing: UnresolvedArm | undefined,
    ): Promise<Ingredient> {
        const next = failureOf({ name, normalizedKey: key, sourcePhrase: null, cascade: finding, food });

        if (existing !== undefined) {
            return this.recordOutcome(caller, existing, food, next);
        }

        const arm = await this.lookups.recordFailure(next);

        return this.failureAnswer(caller, arm);
    }

    /**
     * Count an attempt on an existing failure, merged by R2's rule, and project the result.
     *
     * @param caller - The caller's credential, for naming a settle's target.
     * @param arm - The failure.
     * @param food - Food's answer on this attempt.
     * @param next - The attempt's outcome, when already computed.
     * @returns The failure as it now stands, or the target of a settle that won the race.
     * @sideEffect One conditional update; re-reads on a lost race.
     */
    private async recordOutcome(
        caller: CallerToken | undefined,
        arm: UnresolvedArm,
        food: FoodAddAnswer,
        next = this.outcomeOf(arm, food),
    ): Promise<Ingredient> {
        const written = await this.lookups.recordAttempt(arm, mergeAttempt(arm.failure, next));
        const current = written ?? (await this.requireArm(arm.lookupId));

        // A settle that won the race refused the attempt; the failure now names its target.
        return current.kind === 'unresolved'
            ? this.failureAnswer(caller, current)
            : toIngredient(deriveIngredientLineIdentity(current, new Map()));
    }

    /**
     * The outcome of an attempt on an existing failure.
     *
     * @param arm - The failure.
     * @param food - Food's answer.
     * @returns The outcome. Pure.
     */
    private outcomeOf(arm: UnresolvedArm, food: FoodAddAnswer): ReturnType<typeof failureOf> {
        const { failure } = arm;

        return failureOf({
            name: failure.name,
            normalizedKey: failure.normalizedKey,
            sourcePhrase: null,
            cascade: { kind: 'exhausted', consulted: failure.tiersConsulted, unavailable: failure.tiersUnavailable },
            food,
        });
    }

    /**
     * Food's answer about a pending handle, as an add answer. A `RESOLVED` answer that was not bindable reads as
     * "no source has it"; an absent one likewise.
     *
     * @param handle - The pending food's id.
     * @param answer - Food's answer about it.
     * @returns The add answer. Pure.
     */
    private addAnswerOf(handle: string, answer: FoodRefAnswer): FoodAddAnswer {
        if (answer.outcome === 'found' && answer.status !== 'RESOLVED') {
            return { kind: 'answered', foodId: handle, status: answer.status };
        }

        if (answer.outcome === 'unreachable') {
            return { kind: 'unreachable', detail: 'food refs resolver did not answer' };
        }

        return { kind: 'answered', foodId: handle, status: 'NOT_FOUND' };
    }

    /**
     * Settle a failure when food's evidence frees it: bind the food and move every line on the failure to it.
     *
     * @param arm - The failure.
     * @param evidence - What food said.
     * @returns The bound ingredient, or `undefined` when the evidence does not free the failure.
     * @sideEffect Binds and repoints lines.
     */
    private async settle(arm: UnresolvedArm, evidence: FreeingEvidence): Promise<Ingredient | undefined> {
        const handle = resolvedHandleOf(arm, evidence);

        if (handle === undefined) {
            return undefined;
        }

        const bound = await this.lookups.findOrCreateBound(handle.admission);

        await this.lookups.settleFailure(handle, bound);

        return this.admitted(bound, handle.admission);
    }

    /**
     * Move a converged failure's lines to an already-bound food, when food's evidence frees it.
     *
     * @sideEffect Repoints lines when the evidence frees the failure.
     */
    private async settleWith(arm: UnresolvedArm, bound: BoundArm, evidence: FreeingEvidence): Promise<void> {
        const handle = resolvedHandleOf(arm, evidence);

        if (handle !== undefined) {
            await this.lookups.settleFailure(handle, bound);
        }
    }

    /**
     * Consult the resolution cascade and, on a hit, bind the mapped food.
     *
     * ⛔ TOTAL AND NON-THROWING for the cascade's own failures: an exhausted cascade, a failed tier, or a mapping
     * whose food is no longer bindable all return a miss, so the ordinary path runs. A failure of the ordinary
     * path (food unreachable on the bind check, a database write) still propagates.
     *
     * @param caller - The caller's credential.
     * @param name - The canonical phrase.
     * @param key - Its normalized key.
     * @param userId - The caller, or `undefined` for an unattended import (R22).
     * @returns The bound ingredient, or what the cascade concluded.
     * @sideEffect Runs the tiers; may bind a food and record the resolution event.
     */
    private async resolveThroughCascade(
        caller: CallerToken | undefined,
        name: CanonicalIngredientName,
        key: NormalizedIngredientKey,
        userId: string | undefined,
    ): Promise<CascadeResult> {
        if (this.resolutionTiers.length === 0) {
            return { kind: 'miss', finding: { kind: 'notRun' } };
        }

        const outcome = await runResolutionCascade(
            this.resolutionTiers,
            { key, phrase: name },
            { userId, caller },
            {
                onTierFailure: (tier, error) =>
                    this.logger.warn(
                        `Resolution tier '${tier}' failed; falling through to the food service.`,
                        error instanceof Error ? error.stack : String(error),
                    ),
            },
        );

        if (outcome.kind !== 'resolved') {
            return {
                kind: 'miss',
                finding: {
                    kind: 'exhausted',
                    consulted: outcome.consulted.filter(isCascadeTierId),
                    unavailable: outcome.unavailable.filter(isCascadeTierId),
                },
            };
        }

        const answer = await this.refs.resolveForBind(caller, outcome.food);
        const admission = admitResolvedRef(answer, userId);

        if (!isAdmission(admission)) {
            // The stale-mapping case: expected traffic after a reseed, logged so a sustained rate is visible.
            this.logger.warn(
                `Mapping for '${name}' names ${outcome.food.kind} '${outcome.food.id}', which is not bindable ` +
                    `(${admission.refused}); falling through to the food service.`,
            );

            return {
                kind: 'miss',
                finding: {
                    kind: 'exhausted',
                    consulted: outcome.consulted.filter(isCascadeTierId),
                    unavailable: outcome.unavailable.filter(isCascadeTierId),
                },
            };
        }

        const ingredient = await this.bind(admission);

        await this.recordResolution(ingredient.id, outcome, name);

        return { kind: 'bound', ingredient };
    }

    /**
     * Record which tier produced a binding — the provenance EVENT the verification producer and the band log
     * read. Quietly: a lost event degrades to `unattributed` and must never fail a resolution that succeeded.
     *
     * @sideEffect One insert, and a band-authority read for a ranked resolution.
     */
    private async recordResolution(
        foodLookupId: string,
        outcome: Extract<Awaited<ReturnType<typeof runResolutionCascade>>, { kind: 'resolved' }>,
        name: CanonicalIngredientName,
    ): Promise<void> {
        try {
            await this.resolutions.record({
                foodLookupId,
                tier: outcome.tier,
                // KTD-C: a RANKED resolution persists its full confidence shape.
                ...(outcome.rung === undefined
                    ? {}
                    : {
                          rung: outcome.rung,
                          margin: outcome.confidence,
                          shortlist: outcome.shortlist,
                          queryShape: queryShapeOf(name),
                          rankerVersion: RANKER_VERSION,
                          authorAugmented: outcome.authorAugmented ?? false,
                          // U11/R20: an author-augmented shortlist's margins describe ONE user's catalog, so no
                          // shared band authority is consulted or observed for it.
                          bandEpoch: outcome.authorAugmented
                              ? undefined
                              : await this.observedBandEpoch(outcome.rung, outcome.confidence, name),
                      }),
            });
        } catch (error) {
            this.logger.warn(
                `Resolution provenance write failed for binding '${foodLookupId}' (tier '${outcome.tier}').`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    /**
     * The band-authority epoch a ranked resolution was made under, or `undefined` when the band has never
     * crossed a threshold. Quiet: an unreadable band table degrades to "no epoch observed".
     *
     * @sideEffect One band-authority read.
     */
    private async observedBandEpoch(
        rung: string,
        margin: number | undefined,
        phrase: string,
    ): Promise<string | undefined> {
        try {
            const authority = await this.bands.authorityFor({
                rung,
                marginBand: marginBandOf(margin),
                queryShape: queryShapeOf(phrase),
                rankerVersion: RANKER_VERSION,
            });

            return authority === undefined ? undefined : String(authority.epoch);
        } catch (error) {
            this.logger.warn(
                'Band-authority read failed; the resolution event records no epoch.',
                error instanceof Error ? error.stack : String(error),
            );

            return undefined;
        }
    }

    /**
     * The picker's answer for a failure. A settle is final, so a settled failure is answered with its target, named
     * by food's READ (ADR-0045): nothing is bound here, so the bind check's `502` does not apply. It is answered as
     * it stands when food is not asked (no caller), cannot be asked, or no longer shows the target: the caller named
     * the failure, not the target, and the save forwards the line either way.
     *
     * @param caller - The caller's credential.
     * @param arm - The failure.
     * @returns The target's ingredient, or the failure's.
     * @sideEffect One bindings read and one food read, for a settled failure and a caller.
     */
    private async failureAnswer(caller: CallerToken | undefined, arm: UnresolvedArm): Promise<Ingredient> {
        const target = arm.failure.settledLookupId;
        const asItStands = (): Ingredient => toIngredient(deriveIngredientLineIdentity(arm, new Map()));

        if (target === null || caller === undefined) {
            return asItStands();
        }

        const targetArm = await this.requireArm(target);

        if (targetArm.kind === 'unresolved') {
            throw new Error(`failure ${arm.failure.unresolvedFoodId} is settled onto another failure, ${target}`);
        }

        const identity = (await identifyArmsThrough(this.refs, caller, new Map([[target, targetArm]]), 'read')).get(
            target,
        );

        return identity?.name === undefined ? asItStands() : toIngredient(identity);
    }

    /**
     * Load a binding or throw `RECIPE_NOT_FOUND` (mapped to 404 by the filter).
     *
     * @sideEffect One bindings read.
     */
    private async requireArm(id: string): Promise<FoodLookupArm> {
        const arm = (await this.lookups.findByIds([id])).get(id);

        if (arm === undefined) {
            throw ingredientNotFound(id);
        }

        return arm;
    }
}
