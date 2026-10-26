/**
 * @module @commise/ui/option-label — the shared contract of the design-system `OptionLabel`: the label of one option in
 * a list of choices. Its name, an optional quiet tag after it (the picker's and the matching lists' "Default",
 * `docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`), and an optional variant's parts under it.
 *
 * Display only. The option that holds it owns its role, its accessible name and its press: a tagged option's name must
 * say the tag, and that is the option's to build (`@commise/features-recipes`' `foodChoiceNameOf`).
 */

/**
 * The label's size, a closed pair. `bodyMd`: a combobox option, which matches the field the cook types in. `list`: a
 * line in a list of choices, the 13 px `list` role (owner rule C5). Required, so no caller has a size chosen for it.
 */
export type OptionLabelSize = 'list' | 'bodyMd';

/** Props for the `OptionLabel` leaves (web and native). */
export interface OptionLabelProps {
    /** The option's visible name. */
    readonly label: string;
    /** A quiet word drawn after the label as a `note` badge ("Default"). Localised by the caller. */
    readonly tag?: string;
    /** A variant's parts, in wire order, drawn under the label as `VariantPartsLine` draws them. */
    readonly detailParts?: readonly [string, ...string[]];
    /** The label's size: `bodyMd` for a combobox option, `list` for a line in a list of choices. */
    readonly textSize: OptionLabelSize;
}
