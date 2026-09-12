/**
 * @module @commise/features-recipes/form — the ONE rule for what an editor ingredient row shows in each state:
 * `docs/design/ingredientStatusExplanation.md` SPECIFY.1 (the state table) and §3a (the two-slot column).
 *
 * Both platform leaves render from {@link rowPresentationOf} and decide nothing of their own about status. Before
 * this module each leaf picked its status tint inline, and the two drifted (the P1 defect, since repaired by hand);
 * a rule stated once cannot drift.
 *
 * ⛔ THE FULL TRUTH, ALWAYS. The policy states every action a state offers, including ones whose control has not
 * shipped yet. Whether a control exists is the render layer's business; a policy that hid unbuilt actions would be a
 * staging knob, and the tests would pin the knob instead of the design.
 *
 * Re-keyed onto the plan 002 wire: a declared line arrives as `isUserEntered` (with or without the failure record's
 * `UNRESOLVED` + `author_declared`), and the reason code refines `NOT_FOUND`. `FAILED` needs no reason: migration
 * `0051_ingredient_grain.sql` maps exactly the two transient reasons to `FAILED`, so the status already says
 * "we could not look".
 *
 * Two facts beyond the line ({@link RowFacts}) refine the answer: whether the root has a live variant, which gates Add
 * details (`docs/design/ingredientSpecialization.md` §S7, `docs/design/rowEditorOpenDecisions.md` item 9), and whether
 * the row is in Change food (system change 5).
 *
 * Two deliberate departures from SPECIFY.1's literal "first match wins" order, both recorded in the tests:
 * - A line with NO food is row 2 before it is row 1. `toCreateRecipeInput` drops it on save, and "Your own wording"
 *   on a line that will not be saved is the "looks complete but is silently discarded" failure U28 exists to end.
 * - `NOT_FOUND` for `phrase_unusable` offers no create: an unreadable phrase is not a substance to author
 *   (plan 002 v1 blueprint, question 3 default).
 *
 * Pure and platform-agnostic: no React, no copy, no queries.
 *
 * @pattern Specification — the row's presentation as a function of the line's state
 * @pattern Visitor — an exhaustive `switch` over `FoodResolutionStatus`
 */
import { FoodResolutionStatus, type IngredientVariant } from '@kitchensink/recipe-core';

import { isStandInName } from '../detail/lineName.js';
import { variantPartTexts } from '../detail/lineName.js';
import type { DetailsDialogEntry } from '../details/detailsDialogMachine.js';
import { resolutionStatusWordKey, type ResolutionStatusWordKey } from './statusWord.js';
import { isResolvedIngredientId } from './validate.js';
import type { RecipeFormIngredient } from './values.js';

/** The line fields the policy reads. */
export type RowPolicyLine = Pick<
    RecipeFormIngredient,
    'ingredientId' | 'name' | 'isUserEntered' | 'resolutionStatus' | 'unresolvedReason' | 'variant'
>;

/**
 * What the nutrition read knows about a `RESOLVED` line's figures (rows 3 and 4). `undefined` means not yet known,
 * and then no create is offered: a cook is not told to author a food until we know its figures are missing.
 */
export type RowFigures = 'published' | 'unpublished';

/** What the row knows beyond its line. Every field is required, so a caller states each one. */
export interface RowFacts {
    /** What the nutrition read knows about the figures (`rowFiguresOf`); `undefined` while not known. */
    readonly figures: RowFigures | undefined;
    /**
     * Whether a root-bound line's root has a live variant (`rowHasVariantsOf`); `undefined` while not known, and then
     * no Add details is offered (item 9: never greyed, never shown and then removed).
     */
    readonly hasVariants: boolean | undefined;
    /** The row is in Change food: its name is an entry field and its line still holds the old food (item 4). */
    readonly changing: boolean;
}

/** Whether the name is a search field (entry) or text (record). */
type IngredientRowNameMode = 'entry' | 'record';

/** The state glyph in slot 1: `alert` when the cook can act on the row, `info` otherwise. */
type IngredientRowGlyph = 'info' | 'alert';

/**
 * Every action a row can offer in slot 2. Try again is NOT one: it is the FAILED panel's own action (V1 sign-off item
 * 4), because a menu item whose row changes state under it leaves focus nowhere.
 */
export type IngredientRowAction = 'findFood' | 'createOwnFood' | 'changeFood' | 'addDetails' | 'editDetails' | 'remove';

/** Which panel slot 1's glyph opens. Each kind has exactly one body. */
export type IngredientRowPanel =
    | 'noData'
    | 'twoPaths'
    | 'nutrition'
    | 'working'
    | 'candidates'
    | 'shortlist'
    | 'needsReview'
    | 'notFound'
    | 'failed'
    | 'privateFood'
    | 'foodRemoved'
    | 'foodUnreachable';

/**
 * Slot 2: the single action itself, or a menu of two or more (§3a: a `⋮` that opens a one-item menu is a worse
 * control than the item). Remedy first, Remove last.
 */
type IngredientRowSlot2 =
    | { readonly kind: 'direct'; readonly action: IngredientRowAction }
    | { readonly kind: 'menu'; readonly actions: readonly IngredientRowAction[] };

/**
 * The status word's message key, in `RecipeFormMessages`: a declared line's own word, or the status's word from the ONE
 * status-to-word mapping (`resolutionStatusWordKey`, `./props.ts`). The policy decides WHETHER a row shows a word,
 * never which word a status has.
 */
type IngredientRowStatusWord = 'statusFreeform' | ResolutionStatusWordKey;

/** How the status word reads (`@commise/ui/status-badge`'s tone). */
type IngredientRowTone = 'neutral' | 'caution';

/** Everything a row shows, decided once. */
export interface IngredientRowPresentation {
    readonly nameMode: IngredientRowNameMode;
    /** The stand-in chip takes the name's place (plan 002 R9); then no status word is shown. */
    readonly standIn: boolean;
    readonly glyph: IngredientRowGlyph;
    readonly panel: IngredientRowPanel;
    readonly slot2: IngredientRowSlot2;
    readonly statusWord: IngredientRowStatusWord | undefined;
    readonly tone: IngredientRowTone;
}

/** One state's answer before the stand-in and tone rules are applied. */
interface StateAnswer {
    readonly nameMode: IngredientRowNameMode;
    readonly glyph: IngredientRowGlyph;
    readonly panel: IngredientRowPanel;
    readonly actions: readonly [IngredientRowAction, ...IngredientRowAction[]];
    readonly statusWord: IngredientRowStatusWord | undefined;
    /**
     * The tone of the row's status word, stand-in and no-food note (`namelessLineCopy.md` §2c, the `StatusBadge`
     * sites): `caution` for `NEEDS_REVIEW`, `FOOD_REMOVED` and the no-food line, `neutral` for everything else.
     * ⛔ NOT derived from the glyph: an alert glyph says "there is something to do here"; the caution tint is kept
     * for the rows where the recipe is materially wrong right now, so a list waiting on lookups does not read as a
     * list of faults. Decided in the ONE switch, so a new status forces a tone decision too.
     */
    readonly tone: IngredientRowTone;
}

const record = (
    glyph: IngredientRowGlyph,
    panel: IngredientRowPanel,
    actions: StateAnswer['actions'],
    statusWord: IngredientRowStatusWord | undefined,
    tone: IngredientRowTone,
): StateAnswer => ({ nameMode: 'record', glyph, panel, actions, statusWord, tone });

/** Rows 3-13: a bound, undeclared line, by its status. */
const boundAnswer = (line: RowPolicyLine, figures: RowFigures | undefined): StateAnswer => {
    // ⚠️ A bound line the read said nothing about is `RESOLVED`: `toRecipeFormValues` seeds exactly that default.
    const status = line.resolutionStatus ?? FoodResolutionStatus.RESOLVED;
    const word = resolutionStatusWordKey(status);

    switch (status) {
        case FoodResolutionStatus.RESOLVED:
            return figures === 'unpublished'
                ? record('info', 'nutrition', ['changeFood', 'createOwnFood', 'remove'], undefined, 'neutral')
                : record('info', 'nutrition', ['changeFood', 'remove'], undefined, 'neutral');
        case FoodResolutionStatus.PENDING:
            return record('info', 'working', ['remove'], word, 'neutral');
        case FoodResolutionStatus.PENDING_VERIFICATION:
            return record('info', 'working', ['remove'], word, 'neutral');
        case FoodResolutionStatus.UNRESOLVED:
            // ⛔ The candidate list IS the resolution; Change food here is generic re-entry by a side door.
            return record('alert', 'candidates', ['remove'], word, 'neutral');
        case FoodResolutionStatus.AMBIGUOUS:
            // ⛔ Change food would silently drop the sibling binding and the ONE correction (SPECIFY.1 note 1).
            return record('alert', 'shortlist', ['remove'], word, 'neutral');
        case FoodResolutionStatus.NEEDS_REVIEW:
            return record('alert', 'needsReview', ['changeFood', 'remove'], word, 'caution');
        case FoodResolutionStatus.NOT_FOUND:
            return line.unresolvedReason === 'phrase_unusable'
                ? record('alert', 'notFound', ['changeFood', 'remove'], word, 'neutral')
                : record('alert', 'notFound', ['createOwnFood', 'changeFood', 'remove'], word, 'neutral');
        case FoodResolutionStatus.FAILED:
            // ⛔ Never create: authoring on a transport failure splits one substance in two (SPECIFY.1 note 2). Try again
            // lives in the panel (V1 sign-off item 4), so slot 2 is Remove, direct.
            return record('alert', 'failed', ['remove'], word, 'neutral');
        case FoodResolutionStatus.RESOLVED_UNAVAILABLE:
            // Nothing is wrong (SPECIFY.1 note 3).
            return record('info', 'privateFood', ['remove'], word, 'neutral');
        case FoodResolutionStatus.FOOD_REMOVED:
            return record('alert', 'foodRemoved', ['changeFood', 'createOwnFood', 'remove'], word, 'caution');
        case FoodResolutionStatus.FOOD_UNREACHABLE:
            // ⛔ An outage is never a reason to replace a food (plan 002 R2): no Change food, no create, no word.
            return record('info', 'foodUnreachable', ['remove'], undefined, 'neutral');
    }
};

/** The state's answer, rows 1-13. */
const stateAnswer = (line: RowPolicyLine, figures: RowFigures | undefined): StateAnswer => {
    // ⛔ The SAME predicate `validateRecipeForm` blocks on, so an empty-string id is row 2 here exactly as it is
    // refused there (and as `unresolvedLineNote` marks it).
    if (!isResolvedIngredientId(line.ingredientId)) {
        // Row 2 — the combobox above is the fix, so no Change food.
        return {
            nameMode: 'entry',
            glyph: 'alert',
            panel: 'twoPaths',
            actions: ['createOwnFood', 'remove'],
            statusWord: undefined,
            tone: 'caution',
        };
    }

    if (line.isUserEntered) {
        // Row 1 — ⛔ no create (§5a): the cook already said what this is.
        return {
            nameMode: 'entry',
            glyph: 'info',
            panel: 'noData',
            actions: ['findFood', 'remove'],
            statusWord: 'statusFreeform',
            tone: 'neutral',
        };
    }

    return boundAnswer(line, figures);
};

/** The rows that name their food, and so show a variant's dotted line under the name and offer Edit details
 * (§S1, §S7: rows 3, 4 and 8). */
const NAMES_ITS_FOOD: ReadonlySet<FoodResolutionStatus> = new Set([
    FoodResolutionStatus.RESOLVED,
    FoodResolutionStatus.NEEDS_REVIEW,
]);

/** The actions Change food takes off a row: the row is already being changed (system change 5). */
const CHANGE_ACTIONS: ReadonlySet<IngredientRowAction> = new Set(['changeFood', 'addDetails', 'editDetails']);

/**
 * The details item a state's menu gains, if any (`docs/design/ingredientSpecialization.md` §S7). Edit details on a
 * variant-bound line that names its food; Add details on a root-bound `RESOLVED` line whose root is known to have a
 * live variant.
 *
 * ⚠️ OWNER QUESTION O4 (`docs/design/rowEditorOpenDecisions.md`): plan U12 names no row exception, and item 9's default
 * keeps Add details off row 8 (`NEEDS_REVIEW`). If the owner keeps U12 as written, row 8 gains it here, and `refsOf`
 * then asks for withheld lines' refs (`docs/design/rowEditorBlueprint.md` decision 4).
 */
const detailsActionOf = (line: RowPolicyLine, hasVariants: boolean | undefined): IngredientRowAction | undefined => {
    if (!isResolvedIngredientId(line.ingredientId) || line.isUserEntered) {
        return undefined;
    }

    // ⚠️ A bound line the read said nothing about is `RESOLVED`, as in `boundAnswer`.
    const status = line.resolutionStatus ?? FoodResolutionStatus.RESOLVED;

    if (line.variant !== undefined) {
        return NAMES_ITS_FOOD.has(status) ? 'editDetails' : undefined;
    }

    return status === FoodResolutionStatus.RESOLVED && hasVariants === true ? 'addDetails' : undefined;
};

/**
 * The state's actions with the facts applied: the details item straight after Change food, then, in Change food,
 * without Change food and the details items. Pure.
 */
const actionsWithFacts = (
    line: RowPolicyLine,
    actions: StateAnswer['actions'],
    facts: RowFacts,
): readonly IngredientRowAction[] => {
    const details = detailsActionOf(line, facts.hasVariants);
    const withDetails =
        details === undefined
            ? actions
            : actions.flatMap((action): readonly IngredientRowAction[] =>
                  action === 'changeFood' ? [action, details] : [action],
              );

    return facts.changing ? withDetails.filter((action) => !CHANGE_ACTIONS.has(action)) : withDetails;
};

/**
 * What an editor ingredient row shows. Pure.
 *
 * @param line - The draft line.
 * @param facts - What the row knows beyond its line.
 * @returns The row's presentation.
 */
export const rowPresentationOf = (line: RowPolicyLine, facts: RowFacts): IngredientRowPresentation => {
    const answer = stateAnswer(line, facts.figures);
    const standIn = isStandInName(line);
    const actions = actionsWithFacts(line, answer.actions, facts);
    const [first, ...rest] = actions;

    return {
        nameMode: facts.changing ? 'entry' : answer.nameMode,
        standIn,
        glyph: answer.glyph,
        panel: answer.panel,
        // Remove is in every state's actions and Change food never takes it, so `first` is always an action.
        slot2: rest.length === 0 && first !== undefined ? { kind: 'direct', action: first } : { kind: 'menu', actions },
        // namelessLineCopy §2c: a stand-in row shows no status word, the same as the detail row.
        statusWord: standIn ? undefined : answer.statusWord,
        tone: answer.tone,
    };
};

/**
 * The mode the details dialog opens in for a row's action (§S7): `Edit details` on the line's current variant, and
 * `Add details` otherwise. Pure.
 *
 * @param action - The details action chosen.
 * @param variant - The line's current variant, if it names one.
 * @returns The dialog's entry.
 */
export const detailsEntryOf = (
    action: 'addDetails' | 'editDetails',
    variant: IngredientVariant | undefined,
): DetailsDialogEntry =>
    action === 'editDetails' && variant !== undefined ? { mode: 'edit', current: variant } : { mode: 'add' };

/**
 * The parts of the dotted line a row shows under its name (curated U15, `docs/design/ingredientSpecialization.md`
 * §S1), or `undefined` for a root-bound line (R28) and for a row that does not name its food. The parts come from the
 * line's own binding, so a retired variant still shows them (R29). Pure.
 *
 * @param line - The draft line.
 * @returns The parts' texts in wire order, or `undefined`.
 */
export const rowVariantParts = (line: RowPolicyLine): readonly [string, ...string[]] | undefined => {
    if (!isResolvedIngredientId(line.ingredientId) || line.isUserEntered) {
        return undefined;
    }

    // ⚠️ A bound line the read said nothing about is `RESOLVED`, as in `boundAnswer`.
    return NAMES_ITS_FOOD.has(line.resolutionStatus ?? FoodResolutionStatus.RESOLVED)
        ? variantPartTexts(line.variant?.parts)
        : undefined;
};
