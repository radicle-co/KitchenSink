/**
 * @module @commise/ui/radio-list — the shared contract of the design-system `RadioList`: one choice from a short list,
 * drawn as a column of whole-row radios (the bulk import mode choice,
 * `docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`). Each row is its own bordered card at least
 * 48 px tall, its 18 px radio first, its bolder label wrapping rather than scrolling at 320 px, and an optional hint
 * under it.
 *
 * ⛔ Only for a GENUINE radio group, where moving through the options may change the choice. A list of foods to pick
 * from is not one: the arrow keys would pick a food, so foods are buttons (`FoodChoiceList`, design authority
 * 2026-10-25), and a radio carries no Default tag.
 *
 * Controlled, and it may hold NO choice: `value` `undefined` checks nothing, and the list never checks a row on its own.
 * Every string is a caller-supplied, already localised prop.
 */

/** One row of the list. */
export interface RadioListOption {
    /** The row's id, reported to `onChange`. Unique in the list. */
    readonly id: string;
    /** The visible label, which names the radio. */
    readonly label: string;
    /** A muted line under the label. It describes the radio, read after its name. */
    readonly hint?: string;
}

/** The cross-platform `RadioList` contract. */
export interface RadioListProps {
    /** The group's accessible name ("How to match ingredients"). */
    readonly label: string;
    /** The rows, in the order they are drawn. */
    readonly options: readonly RadioListOption[];
    /** The checked row's id, or `undefined` when nothing is chosen yet. */
    readonly value: string | undefined;
    /** Called with a row's id when the person chooses it. The list holds no state: the host decides. */
    readonly onChange: (id: string) => void;
}
