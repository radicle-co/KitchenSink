/**
 * Turns a version snapshot's lines into the lines a restore writes (plan 002 R52).
 *
 * The bindings the snapshot names are read once, `decideRestoreLine` decides each line, and only then does any
 * write happen: a line that cannot be restored refuses the whole restore before a single binding is created.
 * A name is resolved once however many lines carry it.
 *
 * ⛔ It runs OUTSIDE any transaction: resolving a name asks food.
 *
 * @pattern Imperative Shell — the reads and writes around the pure `decideRestoreLine` policy
 */
import { Injectable } from '@nestjs/common';
import type { RecipeIngredient } from '@kitchensink/recipe-core';

import type { CallerToken } from '../auth/CallerToken.js';
import type { CanonicalIngredientName } from '../ingredients/domain/ingredientName.js';
import { IngredientsService } from '../ingredients/ingredients.service.js';
import { LineIdentityReader } from '../ingredients/lineIdentity.reader.js';
import { versionLineUnrestorable } from '../recipes/recipe.error.js';
import type { RecipeIngredientInput } from '../recipes/recipes.schema.js';
import { decideRestoreLine, type RestoreLineDecision } from './domain/restoreLinePolicy.js';

@Injectable()
export class VersionLineRestorer {
    /**
     * @param identities - The one reader of a binding's identity.
     * @param ingredients - Resolves a name to a binding, or declares one.
     */
    public constructor(
        private readonly identities: LineIdentityReader,
        private readonly ingredients: IngredientsService,
    ) {}

    /**
     * The lines a restore writes, in snapshot order.
     *
     * @param caller - The restoring cook's credential, forwarded to food.
     * @param userId - The restoring cook, whose own corrections the name resolution may consult.
     * @param lines - The snapshot's lines.
     * @returns The request lines for the recipe update.
     * @throws {RecipeDomainError} `VERSION_LINE_UNRESTORABLE` naming every line that has no binding and no name.
     * @sideEffect One bindings read and one food request; at most one binding written per distinct name.
     */
    public async restoreLines(
        caller: CallerToken | undefined,
        userId: string,
        lines: readonly RecipeIngredient[],
    ): Promise<RecipeIngredientInput[]> {
        const identities = await this.identities.identify(
            caller,
            lines.map((line) => line.ingredientId),
            'postCommit',
        );
        const decisions = lines.map((line) => decideRestoreLine(line, identities.get(line.ingredientId)));
        const unrestorable = decisions.flatMap((decision, position) =>
            decision.kind === 'unrestorable' ? [position] : [],
        );

        if (unrestorable.length > 0) {
            throw versionLineUnrestorable(unrestorable);
        }

        const byName = await this.resolveNames(caller, userId, decisions, 'byName');
        const declared = await this.resolveNames(caller, userId, decisions, 'declare');

        return lines.map((line, position) => {
            const decision = decisions[position];

            return {
                ingredientId: lookupIdOf(decision, byName, declared),
                quantity: line.quantity,
                unit: line.unit,
                ...(line.displayText !== undefined ? { notes: line.displayText } : {}),
                // U26/U27 — on the BASE request schema precisely so a restore can carry them.
                ...(line.preparation !== undefined ? { preparation: line.preparation } : {}),
                ...(line.groupLabel !== undefined ? { groupLabel: line.groupLabel } : {}),
                // Preserve per-line user-entered nutrition (FR-007a) across a restore.
                ...(line.userCalories !== undefined ? { userCalories: line.userCalories } : {}),
                ...(line.userProteinG !== undefined ? { userProteinG: line.userProteinG } : {}),
                ...(line.userCarbsG !== undefined ? { userCarbsG: line.userCarbsG } : {}),
                ...(line.userFatG !== undefined ? { userFatG: line.userFatG } : {}),
            };
        });
    }

    /**
     * The binding for each distinct name the decisions of one kind carry.
     *
     * @sideEffect One resolution or declaration per distinct name.
     */
    private async resolveNames(
        caller: CallerToken | undefined,
        userId: string,
        decisions: readonly RestoreLineDecision[],
        kind: 'byName' | 'declare',
    ): Promise<ReadonlyMap<string, string>> {
        const names = [
            ...new Set(
                decisions.flatMap((decision): CanonicalIngredientName[] =>
                    decision.kind === kind ? [decision.name] : [],
                ),
            ),
        ];
        const bound = await Promise.all(
            names.map(async (name) => {
                const ingredient =
                    kind === 'byName'
                        ? await this.ingredients.addByName(caller, name, userId)
                        : await this.ingredients.createFreeform(name);

                return [name, ingredient.id] as const;
            }),
        );

        return new Map(bound);
    }
}

/**
 * The binding a decided line is written with.
 *
 * @throws {Error} when a name has no resolved binding — a defect in {@link VersionLineRestorer.restoreLines}. Pure.
 */
function lookupIdOf(
    decision: RestoreLineDecision | undefined,
    byName: ReadonlyMap<string, string>,
    declared: ReadonlyMap<string, string>,
): string {
    switch (decision?.kind) {
        case 'reuse':
            return decision.lookupId;

        case 'byName':
            return boundIdOf(byName, decision.name);

        case 'declare':
            return boundIdOf(declared, decision.name);

        case 'unrestorable':
        case undefined:
            throw new Error('restore reached an unrestorable line after refusing them');
    }
}

/**
 * The binding the restore made for a name.
 *
 * @throws {Error} when the name has none — a defect in {@link VersionLineRestorer.restoreLines}. Pure.
 */
function boundIdOf(bound: ReadonlyMap<string, string>, name: string): string {
    const id = bound.get(name);

    if (id === undefined) {
        throw new Error(`restore resolved no binding for "${name}"`);
    }

    return id;
}
