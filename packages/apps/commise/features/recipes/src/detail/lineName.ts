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
 * ⛔ D21 (owner, 2026-10-10): the catalog names countable foods in the plural ("onions"), and a count of one reads
 * "1 large onion". {@link nameForQuantity} is that rule, DISPLAY only, applied where a surface composes an amount with
 * a name ({@link lineAmountName}, {@link snapshotLineAmountName}); a name stored, drafted or saved is never singularized.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Special Case (Fowler) — a stand-in name returned through the same interface as a real one, so no caller
 *   branches on a missing name; `isStandInName` tells a row to draw it as the `@commise/ui/stand-in` chip
 */
import {
    classifyUnit,
    FoodResolutionStatus,
    isSizeWord,
    NAMELESS_LINE_STATUSES,
    type IngredientQuantity,
} from '@kitchensink/recipe-core';
import type { IngredientVariantPart, NamelessLineStatus, RecipeIngredient } from '@kitchensink/recipe-core';
import pluralize from 'pluralize';

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

/**
 * A variant's parts as `VariantPartsLine` takes them: their display text in wire order, never empty. Pure.
 *
 * @param parts - The parts a line's binding carries, or a version froze; absent on a root-bound line.
 * @returns The texts, or `undefined` when there is no part to show (R28: a root-bound line shows the name only).
 */
export const variantPartTexts = (
    parts: readonly IngredientVariantPart[] | undefined,
): readonly [string, ...string[]] | undefined => {
    const [first, ...rest] = parts?.map((part) => part.text) ?? [];

    return first === undefined ? undefined : [first, ...rest];
};

// ⚠️ `pluralize`'s global rule tables are amended ONCE, here, for the catalog names its rules get wrong (found by
// running every curated root name through `pluralize.singular`, 833 of 2,642 change): a word that is not a plural at
// all (`molasses`, `pancreas`), a plural kept as sold (`nopales`, `haricots verts`, `oats`), a mass noun the catalog
// names in the plural (`grits`, `bread crumbs`), and `-ie` words it cuts to `-y` (`cookies` → `cooky`).
pluralize.addUncountableRule(
    /\b(?:molasses|pancreas|bordeaux|calvados|pastis|nopales|haricots verts|oats|grits|bitters|crumbs|chitterlings|trimmings|sprinkles)$/iu,
);
pluralize.addSingularRule(/\b(cook|brown|smok|smooth)ies$/iu, '$1ie');
pluralize.addSingularRule(/\bpierogies$/iu, 'pierogi');
pluralize.addSingularRule(/\bchilies$/iu, 'chili');

/** A name with two foods or a qualifier after the head noun, which has no one last word to singularize. */
const COMPOUND_NAME = /\s(?:and|with)\s/iu;

/** Whether `unit` leaves the amount a COUNT of the food: no unit, a size word, or a subjective one. Pure. */
const isCountUnit = (unit: string | undefined): boolean => {
    const stated = unit?.trim() ?? '';

    return stated === '' || isSizeWord(stated) || classifyUnit(stated) === 'subjective';
};

/**
 * The name to show beside an amount: the singular for a count of one, else the name as stored (D21). Pure.
 *
 * Singular when the quantity is one exact value above 0 and at most 1 AND the unit leaves it a count (none, a size
 * word, or a subjective one). A canonical or unknown unit measures the food ("1 cup onions"), a range or an absent
 * amount states no one, and a name with two foods or a qualifier after the noun is left alone: each keeps the name
 * as stored, so the rule only ever errs toward the catalog's own spelling.
 *
 * @param name - The real name (never a stand-in).
 * @param quantity - The line's quantity.
 * @param unit - The line's unit as the cook wrote it.
 * @returns The name to show.
 */
export const nameForQuantity = (name: string, quantity: IngredientQuantity, unit: string | undefined): string => {
    const oneOrLess = quantity.kind === 'exact' && quantity.value > 0 && quantity.value <= 1;

    if (!oneOrLess || !isCountUnit(unit) || COMPOUND_NAME.test(name)) {
        return name;
    }

    return pluralize.singular(name);
};

/**
 * {@link lineDisplayName} for a line shown beside its amount: a real name in the form {@link nameForQuantity} gives it,
 * a stand-in or an empty name untouched. Pure.
 *
 * @param line - The line to name.
 * @param quantity - Its quantity (an editor line's, parsed).
 * @param unit - Its unit.
 * @param labels - The stand-ins for the active locale.
 * @returns The text that names the line beside its amount.
 */
export const lineAmountName = (
    line: NameableLine,
    quantity: IngredientQuantity,
    unit: string | undefined,
    labels: IngredientLineNameMessages,
): string => {
    const name = lineDisplayName(line, labels);

    return isStandInName(line) ? name : nameForQuantity(name, quantity, unit);
};

/**
 * {@link snapshotLineName} for a version line shown beside its amount: the frozen name in the form
 * {@link nameForQuantity} gives it, the "not saved" stand-in untouched. Pure.
 *
 * @param line - The snapshot line.
 * @param labels - The stand-ins for the active locale.
 * @returns The text that names the snapshot line beside its amount.
 */
export const snapshotLineAmountName = (line: RecipeIngredient, labels: IngredientLineNameMessages): string => {
    const name = snapshotLineName(line, labels);

    return line.ingredientName !== undefined && line.ingredientName.length > 0
        ? nameForQuantity(name, line.quantity, line.unit)
        : name;
};
