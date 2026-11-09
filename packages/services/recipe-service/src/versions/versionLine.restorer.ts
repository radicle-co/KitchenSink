/**
 * Turns a version snapshot's lines into the lines a restore writes (plan 002 R52).
 *
 * The bindings the snapshot names are read once, `decideRestoreLine` decides each line, and only then does any
 * write happen: a line that cannot be restored refuses the whole restore before a single binding is created.
 * A name is declared once however many lines carry it. A restore binds what the version defined and resolves nothing:
 * a food or binding that is gone comes back as its declared name (owner ruling 2026-11-03).
 *
 * ⛔ It runs OUTSIDE any transaction.
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
     * @returns The request lines for the recipe update.
     * @throws {RecipeDomainError} `VERSION_LINE_UNRESTORABLE` naming every line that has no binding and no name.
     * @sideEffect One bindings read and one food request; at most one binding written per distinct name.
     */
    public async restoreLines(
        caller: CallerToken | undefined,
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

        const declared = await this.declareNames(decisions);

        return lines.map((line, position) => {
            const decision = decisions[position];

            return {
                ingredientId: lookupIdOf(decision, declared),
                quantity: line.quantity,
                unit: line.unit,
                ...(line.displayText !== undefined ? { displayText: line.displayText } : {}),
                ...(line.note !== undefined ? { note: line.note } : {}),
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
     * The declared binding for each distinct name the decisions carry: the line comes back unbound under its frozen
     * name, and the cook picks a food through the lookup. Nothing is resolved.
     *
     * @sideEffect One declaration per distinct name.
     */
    private async declareNames(decisions: readonly RestoreLineDecision[]): Promise<ReadonlyMap<string, string>> {
        const names = [
            ...new Set(
                decisions.flatMap((decision): CanonicalIngredientName[] =>
                    decision.kind === 'declare' ? [decision.name] : [],
                ),
            ),
        ];
        const bound = await Promise.all(
            names.map(async (name) => [name, (await this.ingredients.createFreeform(name)).id] as const),
        );

        return new Map(bound);
    }
}

/**
 * The binding a decided line is written with.
 *
 * @throws {Error} when a name has no resolved binding — a defect in {@link VersionLineRestorer.restoreLines}. Pure.
 */
function lookupIdOf(decision: RestoreLineDecision | undefined, declared: ReadonlyMap<string, string>): string {
    switch (decision?.kind) {
        case 'reuse':
            return decision.lookupId;

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
