/**
 * @module @commise/features-recipes — the one place a recipe line gets the text that names it.
 *
 * The recipe database stores no food names (plan 002 R9): a line's name comes from its food at read time, and a
 * line has none when the viewer may not see the food, when the food is gone, or when food could not be asked
 * (`NAMELESS_LINE_STATUSES`). This is the client twin of R10's "the name derivation MUST live in exactly one place":
 * every surface that names a line calls these functions and never reads `name` or `ingredientName` itself, so a
 * missing name renders the same stand-in everywhere (`docs/design/namelessLineCopy.md` §1). `model.ts` composes
 * them with a line's quantity (`lineSummary`, `formatIngredientLine`).
 *
 * ⛔ The stand-in is DISPLAY text only. It is never written into form values, a merge projection or anything a save
 * or a diff reads, or a save would send a food called "Private ingredient".
 *
 * ⛔ No fallback of any kind: nothing here reads a line's notes or preparation to stand in for its food.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Special Case (Fowler) — a stand-in name returned through the same interface as a real one, so no caller
 *   branches on a missing name; `isStandInName` tells a row to draw it as the `@commise/ui/stand-in` chip
 */
import { FoodResolutionStatus, NAMELESS_LINE_STATUSES } from '@kitchensink/recipe-core';
import type { NamelessLineStatus, RecipeIngredient } from '@kitchensink/recipe-core';

import type { IngredientLineNameMessages } from '../messages.js';

/** What naming a live line reads: its name, when it has one, and its status. The editor's lines fit it too. */
export interface NameableLine {
    readonly name?: string | undefined;
    readonly resolutionStatus?: FoodResolutionStatus | undefined;
}

/**
 * Which stand-in each nameless status shows. A `Record` over the status set, so a status added to
 * `NAMELESS_LINE_STATUSES` without a stand-in is a compile error rather than an empty chip.
 */
const STAND_IN_BY_STATUS: Readonly<Record<NamelessLineStatus, keyof IngredientLineNameMessages>> = {
    [FoodResolutionStatus.RESOLVED_UNAVAILABLE]: 'privateFood',
    [FoodResolutionStatus.FOOD_REMOVED]: 'removedFood',
    [FoodResolutionStatus.FOOD_UNREACHABLE]: 'notLoaded',
};

/** Whether a status is one a line can reach the client without a name under. Pure. */
const isNamelessStatus = (status: FoodResolutionStatus | undefined): status is NamelessLineStatus =>
    NAMELESS_LINE_STATUSES.some((nameless) => nameless === status);

/**
 * The text that names a line: its own name, or the stand-in for the status that left it without one. Pure.
 *
 * A name wins whatever the status, so a withdrawn food that kept its name shows that name.
 *
 * @param line - The line to name.
 * @param labels - The stand-ins for the active locale.
 * @returns The name or stand-in. The empty string for a draft line that has no name yet and no nameless status.
 */
export const lineDisplayName = (line: NameableLine, labels: IngredientLineNameMessages): string => {
    if (line.name !== undefined && line.name.length > 0) {
        return line.name;
    }

    return isNamelessStatus(line.resolutionStatus) ? labels[STAND_IN_BY_STATUS[line.resolutionStatus]] : '';
};

/**
 * Whether a line shows a stand-in rather than a name — the rows render the stand-in as a chip. Pure.
 *
 * @param line - The line to judge.
 * @returns `true` when {@link lineDisplayName} answers with a stand-in.
 */
export const isStandInName = (line: NameableLine): boolean =>
    (line.name === undefined || line.name.length === 0) && isNamelessStatus(line.resolutionStatus);

/**
 * The text that names a VERSION SNAPSHOT line: the name the version froze, or the stand-in saying it froze none.
 * A snapshot carries no status, because a version is history (R52). Pure.
 *
 * @param line - The snapshot line.
 * @param labels - The stand-ins for the active locale.
 * @returns The frozen name, or {@link IngredientLineNameMessages.notSavedInVersion}.
 */
export const snapshotLineName = (line: RecipeIngredient, labels: IngredientLineNameMessages): string =>
    line.ingredientName !== undefined && line.ingredientName.length > 0
        ? line.ingredientName
        : labels.notSavedInVersion;
