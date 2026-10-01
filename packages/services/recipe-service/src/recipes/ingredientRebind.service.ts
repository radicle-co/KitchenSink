/**
 * Move ONE recipe line to another food (plan 002 U5, R17, AE3, AE6, AE9, AE11).
 *
 * The command owns one line's intent and delegates the write to the recipe update path, so the rebind gets the
 * version, the snapshot, the search text, the verification request and the visibility policy that every recipe
 * write gets — there is no second write path to drift. It knows no SQL and derives no name.
 *
 * The order of its effects is the contract:
 * 1. ownership and version are checked before anything is written;
 * 2. the target is bound, so the privacy fact exists when the correction's reach is decided;
 * 3. the correction is recorded BEFORE the line is repointed (R17), and only when the line moves to a food;
 * 4. the line is repointed through the update path, every other line unchanged;
 * 5. the binding the line left is deleted AFTER the update commits, and only if nothing else uses it (R14, AE9).
 *
 * ⚠️ The version can move between the check (1) and the update's own compare-and-swap. A correction written in that
 * window survives the resulting 409; it records what the cook said the phrase means, which stays true.
 *
 * @pattern Command handler — the request body is the Command; this runs it through the recipe update path
 */
import { Injectable, Logger } from '@nestjs/common';
import type { Ingredient } from '@kitchensink/recipe-core';

import type { CallerToken } from '../auth/CallerToken.js';
import type { Principal } from '../auth/principal.js';
import { apiError } from '../common/apiError.js';
import { FoodLookupsDal } from '../ingredients/dal/foodLookups.dal.js';
import { isTransientReason } from '../ingredients/domain/failureOutcome.js';
import { canonicalIngredientName } from '../ingredients/domain/ingredientName.js';
import type { RebindIngredientLineRequest } from '../ingredients/ingredients.schema.js';
import { IngredientsService } from '../ingredients/ingredients.service.js';
import { ResolutionMappingsService } from '../ingredients/resolution/resolutionMappings.service.js';
import type { IngredientRow } from '../database/schema/index.js';
import { correctionPhraseOf, toLineRequest } from './domain/ingredientRebind.js';
import type { RecipeResponse } from './dto/recipeResponse.dto.js';
import { RecipesService } from './recipes.service.js';

@Injectable()
export class IngredientRebindService {
    private readonly logger = new Logger(IngredientRebindService.name);

    /**
     * @param recipes - The recipe write and read paths.
     * @param ingredients - Binds a picked food or resolves a name.
     * @param corrections - The one corrections store (R18).
     * @param lookups - The bindings repository.
     */
    public constructor(
        private readonly recipes: RecipesService,
        private readonly ingredients: IngredientsService,
        private readonly corrections: ResolutionMappingsService,
        private readonly lookups: FoodLookupsDal,
    ) {}

    /**
     * Rebind the line at `position` to the target.
     *
     * @param principal - The cook, who must own the recipe.
     * @param recipeId - The recipe.
     * @param position - The line's 0-based position in author order (its `sort_order`).
     * @param body - The version the cook edited, and the target.
     * @param caller - The cook's credential, forwarded to food.
     * @returns The recipe detail after the rebind.
     * @throws {RecipeDomainError} `RECIPE_NOT_FOUND`, `NOT_OWNER` or `VERSION_CONFLICT` before anything is written.
     * @throws {HttpException} `VALIDATION_FAILED` for a position with no line or a name with no visible content,
     *   and the by-food path's refusal for a food that cannot back a line.
     * @sideEffect May bind a food, record a correction, update the recipe and delete the binding the line left.
     */
    public async rebind(
        principal: Principal,
        recipeId: string,
        position: number,
        body: RebindIngredientLineRequest,
        caller: CallerToken | undefined,
    ): Promise<RecipeResponse> {
        const aggregate = await this.recipes.findEditableAggregate(
            principal.userId,
            recipeId,
            body.expectedVersion,
            caller,
        );
        const line = aggregate.ingredients.find((row) => row.sortOrder === position);

        if (line === undefined) {
            throw apiError('VALIDATION_FAILED', 'The recipe has no ingredient line at that position.', {
                fields: [`position: no ingredient line at position ${position}`],
            });
        }

        const target = await this.bindTarget(principal.userId, body.target, caller);

        if (target.id === line.foodLookupId) {
            // The line already points here. Re-saving would mint a version for nothing.
            return this.recipes.getById({ viewerId: principal.userId, id: recipeId, caller, budget: 'read' });
        }

        await this.recordCorrection(principal, line, target, caller);

        const response = await this.recipes.update(
            principal,
            recipeId,
            {
                expectedVersion: body.expectedVersion,
                ingredients: aggregate.ingredients.map((row) =>
                    row.id === line.id ? { ...toLineRequest(row), ingredientId: target.id } : toLineRequest(row),
                ),
            },
            caller,
            { snapshot: { changeSummary: 'Changed ingredient' } },
        );

        await this.deleteLeftBinding(line.foodLookupId);

        return response;
    }

    /**
     * Bind the target: a picked food through the by-food admission, or a name through the by-name cascade.
     *
     * @throws {HttpException} `502 SOURCE_UNAVAILABLE` when food could not be asked, before any recipe write.
     * @sideEffect May create a binding and a failure record, asks food, and reads the binding.
     */
    private async bindTarget(
        userId: string,
        target: RebindIngredientLineRequest['target'],
        caller: CallerToken | undefined,
    ): Promise<Ingredient> {
        if (target.kind === 'catalogFood') {
            return this.ingredients.addByFoodId(caller, target.foodId, userId);
        }

        const name = canonicalIngredientName(target.name);

        if (name === undefined) {
            throw apiError('VALIDATION_FAILED', 'The name has no visible content.', {
                fields: ['target.name: no visible content'],
            });
        }

        const ingredient = await this.ingredients.addByName(caller, name, userId);
        const arm = (await this.lookups.findByIds([ingredient.id])).get(ingredient.id);

        // ⛔ The by-food rule, for a name: a bind is never made on no answer. A name that landed on a "could not
        // look" failure would move the line there, and when food later answers, an AUTOMATIC settle moves it on —
        // which may record no correction (R22), so the cook's teaching would be lost. A definite failure (AE6) still
        // moves the line.
        if (arm?.kind === 'unresolved' && isTransientReason(arm.failure.reasonCode)) {
            throw apiError('SOURCE_UNAVAILABLE', 'We could not reach our food database to check that name.');
        }

        return ingredient;
    }

    /**
     * Record that the line's unmatched name means the target's food — only when the line moved to a food and has
     * an unmatched name to teach (R17, `correctionPhraseOf`).
     *
     * @sideEffect One bindings read and at most one correction write.
     */
    private async recordCorrection(
        principal: Principal,
        line: IngredientRow,
        target: Ingredient,
        caller: CallerToken | undefined,
    ): Promise<void> {
        if (target.foodId === undefined) {
            return;
        }

        const arm = (await this.lookups.findByIds([line.foodLookupId])).get(line.foodLookupId);
        const phrase = arm === undefined ? (line.sourcePhrase ?? undefined) : correctionPhraseOf(line, arm);

        if (phrase === undefined) {
            return;
        }

        await this.corrections.recordCorrection({
            principal,
            phrase,
            foodId: target.foodId,
            surfacing: 'row_rebind',
            ...(caller === undefined ? {} : { caller }),
        });
    }

    /**
     * Delete the binding the line left, if it is a failure record nothing else uses (R14). Runs after the update
     * committed, so a failure here must not fail the response: the orphan waits for the reaper ADR-0045 owes.
     *
     * @sideEffect At most two deletes.
     */
    private async deleteLeftBinding(lookupId: string): Promise<void> {
        try {
            await this.lookups.deleteIfOrphanedFailure(lookupId);
        } catch (error) {
            this.logger.warn(
                `Deleting the binding a rebind left (${lookupId}) failed; it stays until the reaper removes it.`,
                error instanceof Error ? error.stack : String(error),
            );
        }
    }
}
