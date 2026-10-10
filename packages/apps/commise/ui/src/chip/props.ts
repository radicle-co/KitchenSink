/**
 * @module @commise/ui/chip — the shared contract of the design-system `Chip` and `ChipRow`
 * (`docs/architecture/uiOverhaulBlueprint.md` Part B; `docs/design/uiOverhaul/buildSpec.md` §1.10, §1.11). Both platform
 * leaves of each implement exactly these props.
 *
 * - A `filter` chip toggles one facet on and off: a pressed/checked control (web `aria-pressed`, native `checkbox`).
 * - An `input` chip is a value the person entered or applied (a filter in force, a tag): pressing it REMOVES it, so it
 *   is a button named by the caller's "Remove {label}" and carries a trailing `x`. There is no `tag` kind: a chip that
 *   cannot be pressed is text, by the shape rule ("only pressable controls are pills").
 * - A CHOICE among options is not a chip a screen places: the `ChipRow` in `choice` mode owns its options, because the
 *   group semantics (a radio group, arrow keys, at most one checked) belong to the row, not to any one chip.
 *
 * The discriminated unions make illegal combinations unwritable: a `filter` chip has no `onRemove`, an `input` chip no
 * `selected`, and only a `choice` row has options.
 */
import type { ReactNode } from 'react';

/** A chip that toggles one facet. */
export interface FilterChipProps {
    readonly kind: 'filter';
    /** The facet's name. Over 24 visible characters it truncates; the full name stays the accessible name. */
    readonly label: string;
    /** Whether the facet is on. */
    readonly selected: boolean;
    /** How many results the facet holds, in `figure` digits after the label. */
    readonly count?: number;
    /** Toggle the facet. */
    readonly onPress: () => void;
}

/** A chip that shows a value and removes it when pressed. */
export interface InputChipProps {
    readonly kind: 'input';
    /** The value's name. Over 24 visible characters it truncates. */
    readonly label: string;
    /** The localised accessible name of the remove action, which contains the label ("Remove Vegan"). */
    readonly removeLabel: string;
    /** Remove the value. */
    readonly onRemove: () => void;
}

/** The cross-platform `Chip` contract. */
export type ChipProps = FilterChipProps | InputChipProps;

/** How a row lays its chips out when they do not fit one line. */
export type ChipRowOverflow = 'scroll' | 'wrap';

/** One option of a choice row. */
export interface ChipOption {
    /** The value the row reports. Unique in the row. */
    readonly value: string;
    /** The option's visible name. */
    readonly label: string;
}

/** A row of filter or input chips that the screen places itself. */
export interface ChipGroupRowProps {
    readonly mode: 'filter' | 'input';
    /** The group's accessible name. */
    readonly label: string;
    /** One line that scrolls inside itself, or wrapped lines. */
    readonly overflow: ChipRowOverflow;
    /** The chips. */
    readonly children: ReactNode;
}

/** A row that is one choice among its options. */
export interface ChoiceRowProps {
    readonly mode: 'choice';
    /** The group's accessible name. */
    readonly label: string;
    /** One line that scrolls inside itself, or wrapped lines. */
    readonly overflow: ChipRowOverflow;
    /** The options, in order. */
    readonly options: readonly ChipOption[];
    /** The chosen option's value, or `null` for none. */
    readonly value: string | null;
    /** Report a new choice — `null` when a clearable row's choice is pressed again. */
    readonly onChange: (value: string | null) => void;
    /** Pressing the chosen option clears the choice (difficulty). Defaults to `false`: a choice, once made, stays. */
    readonly clearable?: boolean;
}

/** The cross-platform `ChipRow` contract. */
export type ChipRowProps = ChipGroupRowProps | ChoiceRowProps;
