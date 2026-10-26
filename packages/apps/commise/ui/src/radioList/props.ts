/**
 * @module @commise/ui/radio-list — the shared contract of the design-system `RadioList`: one choice from a short list,
 * drawn as a column of whole-row radios (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, the
 * option list and the bulk import mode choice). Each row is at least 48 px tall, its 18 px radio first, its label
 * wrapping rather than scrolling at 320 px, an optional quiet tag after the label and an optional hint under it.
 *
 * Controlled, and it may hold NO choice: `value` `undefined` checks nothing, and the list never checks a row on its own
 * (the owner ruling that a default is shown, never chosen for the cook). Every string is a caller-supplied, already
 * localised prop.
 */

/** One row of the list. */
export interface RadioListOption {
    /** The row's id, reported to `onChange`. Unique in the list. */
    readonly id: string;
    /** The visible label, which names the radio. */
    readonly label: string;
    /** A quiet tag after the label ("Default"). Part of the radio's name, so it is never conveyed by look alone. */
    readonly tag?: string;
    /** A muted line under the label ("No nutrition for this line"). It describes the radio. */
    readonly hint?: string;
}

/**
 * How the rows are drawn. `rows`: one bordered group, rows divided by hairlines (an option list). `cards`: each row its
 * own bordered card with a bolder label (a choice of modes). Only the look differs; the semantics are the same.
 */
export type RadioListLook = 'rows' | 'cards';

/** The cross-platform `RadioList` contract. */
export interface RadioListProps {
    /** The group's accessible name ("Food for 2 cups milk"). */
    readonly label: string;
    /** The rows, in the order they are drawn. */
    readonly options: readonly RadioListOption[];
    /** The checked row's id, or `undefined` when nothing is chosen yet. */
    readonly value: string | undefined;
    /** Called with a row's id when the person chooses it. The list holds no state: the host decides. */
    readonly onChange: (id: string) => void;
    /** How the rows are drawn. */
    readonly look: RadioListLook;
}
