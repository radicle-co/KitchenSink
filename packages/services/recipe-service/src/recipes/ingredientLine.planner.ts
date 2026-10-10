/**
 * The I/O a recipe write does BEFORE its transaction (plan 002 U4, R9, R10).
 *
 * A write's lines name bindings (`food_lookups` rows). The planner loads them, reads their identities through
 * the one `LineIdentityReader`, and returns what the transaction persists together with each line's identity —
 * the search text, the version snapshot and the verification producer all read the identity, so the name is
 * derived once. A line naming a binding that does not exist is refused here, before anything is written.
 *
 * ⛔ It never takes a transaction, and it must run outside one: ADR-0034 forbids holding a Postgres transaction
 * across a network call. Food not answering degrades a line to nameless — never a failed save.
 *
 * @pattern Imperative Shell — the write's reads, around the pure line mapping
 */
import { Injectable } from '@nestjs/common';

import type { CallerToken } from '../auth/CallerToken.js';
import { FoodLookupsDal } from '../ingredients/dal/foodLookups.dal.js';
import type { IngredientLineIdentity } from '../ingredients/domain/ingredientLineIdentity.js';
import { LineIdentityReader } from '../ingredients/lineIdentity.reader.js';
import type { IngredientLineInput } from './dal/ingredientLines.dal.js';
import { ingredientNamesText } from './domain/ingredientNamesText.js';
import { unknownIngredient } from './recipe.error.js';
import type { CreateRecipeIngredientInput } from './recipes.schema.js';

/** What a write persists, and the identity of each of its bindings. */
export interface IngredientLinePlan {
    /** The lines to persist, in author order. */
    readonly inputs: readonly IngredientLineInput[];
    /** Each binding's identity, by lookup id. */
    readonly identities: ReadonlyMap<string, IngredientLineIdentity>;
    /** The `ingredient_names_text` search column, from the lines' names. */
    readonly namesText: string;
}

/** One line on a create or update request. A create's line may carry its transcription; an update's never does. */
type PlannedLine = Omit<CreateRecipeIngredientInput, 'sourceLine' | 'sourcePhrase' | 'statedMeasure'> &
    Partial<Pick<CreateRecipeIngredientInput, 'sourceLine' | 'sourcePhrase' | 'statedMeasure'>>;

/**
 * Map one request line to the row the transaction persists. Array order becomes `sortOrder`.
 *
 * @param line - The request line.
 * @param index - Its position.
 * @returns The line to persist. Pure.
 */
function toLineInput(line: PlannedLine, index: number): IngredientLineInput {
    return {
        foodLookupId: line.ingredientId,
        quantity: line.quantity,
        unit: line.unit ?? '',
        ...(line.notes !== undefined ? { displayText: line.notes } : {}),
        ...(line.preparation !== undefined ? { preparation: line.preparation } : {}),
        ...(line.groupLabel !== undefined ? { groupLabel: line.groupLabel } : {}),
        // Create-only: an update's lines arrive without these and inherit the stored transcription afterwards
        // (`domain/transcriptionCarryForward.ts`).
        ...(line.sourceLine !== undefined ? { sourceLine: line.sourceLine } : {}),
        ...(line.sourcePhrase !== undefined ? { sourcePhrase: line.sourcePhrase } : {}),
        ...(line.statedMeasure !== undefined ? { statedMeasure: line.statedMeasure } : {}),
        sortOrder: index,
        ...(line.userCalories !== undefined ? { userCalories: line.userCalories } : {}),
        ...(line.userProteinG !== undefined ? { userProteinG: line.userProteinG } : {}),
        ...(line.userCarbsG !== undefined ? { userCarbsG: line.userCarbsG } : {}),
        ...(line.userFatG !== undefined ? { userFatG: line.userFatG } : {}),
    };
}

@Injectable()
export class IngredientLinePlanner {
    /**
     * @param lookups - The bindings repository.
     * @param identities - The one reader of a binding's identity.
     */
    public constructor(
        private readonly lookups: FoodLookupsDal,
        private readonly identities: LineIdentityReader,
    ) {}

    /**
     * Plan a write's lines.
     *
     * @param caller - The writer's credential, forwarded to food for the names.
     * @param lines - The request's lines, in author order.
     * @returns What to persist (a line naming a settled failure is forwarded to the settle target), each binding's
     *   identity, and the search text.
     * @throws {RecipeDomainError} `UNKNOWN_INGREDIENT` when a line names a binding that does not exist.
     * @sideEffect One bindings read and at most one batched food request.
     */
    public async plan(caller: CallerToken | undefined, lines: readonly PlannedLine[]): Promise<IngredientLinePlan> {
        const requested = await this.lookups.findByIds(lines.map((line) => line.ingredientId));

        for (const line of lines) {
            if (!requested.has(line.ingredientId)) {
                throw unknownIngredient(line.ingredientId);
            }
        }

        // ⛔ FORWARD a line that names a SETTLED failure to the binding the settle moved that failure's lines to
        // (plan 002 R13). A settle mints no recipe version, so a save built from a read taken before it still
        // names the failure; stored as sent, it would undo the settle and read as an ingredient edit.
        const forwardOf = (id: string): string => {
            const arm = requested.get(id);

            return arm?.kind === 'unresolved' && arm.failure.settledLookupId !== null
                ? arm.failure.settledLookupId
                : id;
        };

        const forwarded = lines.map((line) => ({ ...line, ingredientId: forwardOf(line.ingredientId) }));
        const lookupIds = forwarded.map((line) => line.ingredientId);
        const targets = lookupIds.filter((id) => !requested.has(id));
        const arms =
            targets.length === 0 ? requested : new Map([...requested, ...(await this.lookups.findByIds(targets))]);

        for (const [index, id] of lookupIds.entries()) {
            if (!arms.has(id)) {
                // The settle target is kept by a RESTRICT foreign key, so this is a defect, reported as the id the
                // cook sent.
                throw unknownIngredient(lines[index]?.ingredientId ?? id);
            }
        }

        // A write's names are extra information on a save that must not wait on a slow food service, so they run
        // under the short post-commit budget; a line food could not name saves nameless.
        const identities = await this.identities.identifyArms(caller, arms, 'postCommit');

        return {
            inputs: forwarded.map(toLineInput),
            identities,
            namesText: ingredientNamesText(lookupIds, identities),
        };
    }
}
