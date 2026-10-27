/**
 * @module @commise/features-recipes/ingredientMatching — the contract `SeeWhy`'s web and native leaves share: a
 * disclosure that opens a line's reason in place.
 */

/** Props for `SeeWhy`. */
export interface SeeWhyProps {
    /** The visible words ("See why"). */
    readonly label: string;
    /** A longer accessible name that STARTS with {@link label} (WCAG 2.5.3), for a control that names its line. */
    readonly name?: string;
    /** The reason the control opens. */
    readonly reason: string;
    /** The disclosure was opened: the host says the reason once in its polite region. Not called on closing. */
    readonly onOpen: () => void;
}
