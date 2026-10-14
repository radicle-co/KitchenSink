/**
 * @module @commise/ui/combobox — the platform-neutral contract of the design-system `Combobox`: a text field whose
 * suggestions show in a list below it, chosen explicitly (`docs/design/ingredientStatusExplanation.md` §2a, §3, §4,
 * §8d; `docs/design/rowEditorOpenDecisions.md` system changes 1 to 4 and 8). The W3C ARIA APG Combobox pattern with
 * list autocomplete and manual selection.
 *
 * The host owns the text and the suggestions; the primitive owns only whether the list shows and which option is
 * active. Every string is a caller-supplied, already-localised prop.
 */
import type { ReactNode } from 'react';

/** One suggestion. Its decoration is presentation only: an option holds no control (APG). */
export interface ComboboxOption {
    /** Stable identity among the options: the active descendant and the selection are keyed by it. */
    readonly key: string;
    /** The option's visible text, and its accessible name unless {@link accessibleName} is given. */
    readonly label: string;
    /** A variant's parts, in wire order, drawn under the label as `VariantPartsLine` draws them. */
    readonly detailParts?: readonly [string, ...string[]];
    /**
     * The option's accessible name, when it says more than its visible text. It starts with {@link label}
     * (WCAG 2.5.3).
     */
    readonly accessibleName?: string;
    /**
     * Work the option started is in flight (a pick being added): it reads busy and refuses a second press or Enter.
     * `aria-disabled`, never `disabled`, so it keeps its place in the list (V1 sign-off, "Busy and disabled").
     */
    readonly busy?: boolean;
}

/** A labelled run of options, such as one source's results. */
export interface ComboboxGroup {
    readonly key: string;
    /** The group's accessible name, and its visible heading. Omitted for a list with one unnamed run. */
    readonly label?: string;
    readonly options: readonly ComboboxOption[];
}

/**
 * A line the popup shows before or after its options. Shown, never announced: the host speaks through
 * {@link ComboboxProps.countAnnouncement} and {@link ComboboxProps.alertAnnouncement}.
 */
export type ComboboxStatus =
    /**
     * A search is in flight: ONE still line, the host's `loadingIcon` and `label`
     * (`docs/design/rowEditorOpenDecisions.md` system change 11). It never moves, so it needs no pause control (2.2.2).
     */
    | { readonly kind: 'loading'; readonly label: string }
    /** A standing fact about the list: no matches, a source unavailable. */
    | { readonly kind: 'note'; readonly text: string };

/** A visible way out of the entry, at the field's trailing end (a row in Change food). */
export interface ComboboxCancel {
    /** The visible text. */
    readonly text: string;
    /** The accessible name, which starts with {@link text} (WCAG 2.5.3) and says what is kept. */
    readonly name: string;
    readonly onPress: () => void;
}

/** NATIVE ONLY: a button that empties the field. The web field clears with Escape, through `onAbandon`. */
export interface ComboboxClear {
    /** The button's accessible name. */
    readonly label: string;
    /** The decorative glyph, in the platform's idiom, as `ButtonProps.icon` takes it. */
    readonly icon: ReactNode;
}

/** Props for the `Combobox` leaves (web and native). */
export interface ComboboxProps {
    /**
     * The field's id: the target of its visible label, and the prefix of its hint's id (`fieldHintId`). Unique on the
     * page. On native it is the field's `nativeID`, which a press on the label focuses.
     */
    readonly id: string;
    /** The text field's accessible name, and its visible label unless {@link labelVisibility} is `hidden`. */
    readonly label: string;
    /**
     * Whether the label shows above the field. Defaults to `visible`: every field has a visible label (SC 3.3.2). A
     * field a row already names in its own words, such as the food search inside a row, passes `hidden`: the label stays
     * its accessible name and its hint is still read, but neither is drawn.
     */
    readonly labelVisibility?: 'visible' | 'hidden';
    /** The suggestion list's accessible name. */
    readonly listLabel: string;
    /** The controlled text. */
    readonly value: string;
    readonly onValueChange: (value: string) => void;
    readonly placeholder?: string;
    /** The suggestions, in display order. Keyboard navigation runs over every group's options in this order. */
    readonly groups: readonly ComboboxGroup[];
    /**
     * A line the cook must read before any option, shown before them (`docs/design/rowEditorOpenDecisions.md` R1): why
     * there is no result to show first, or an error. A line about results the list shows goes in
     * {@link trailingStatus}. The host picks the slot once per text, never by size, so a line never changes place under
     * the cook (`docs/design/v3Evaluation.md` V3-M2a; S7 list contract P2).
     */
    readonly status?: ComboboxStatus;
    /**
     * Lines about results the list shows, after the options, in the host's order (system change 11, V3-M2a): in the
     * ingredient entry, the line that qualifies the foods shown, then each remote source's note, then the line of a
     * search still in flight. They sit outside the listbox, which owns only groups and options.
     */
    readonly trailingStatus?: readonly ComboboxStatus[];
    /**
     * The decorative glyph a `loading` line shows before its label, in the platform's idiom. Hidden from assistive
     * technology: the label says what is happening.
     */
    readonly loadingIcon?: ReactNode;
    /** Called with an option's key when the cook chooses it: Enter on the active option, or a press. Never on typing. */
    readonly onSelect: (key: string) => void;
    /**
     * The cook submitted the field without choosing: Enter with no option active on web (never while an input method
     * composes), the keyboard's submit key on native, which keeps the keyboard up. Nothing is chosen; the host may say
     * why (build spec §7.5.3, "Pick a food from the list.").
     */
    readonly onSubmitWithoutChoice?: () => void;
    /**
     * The polite channel (WCAG 4.1.3), localised by the host: what the list holds for the field's CURRENT text. That is
     * the settled read of that text, `searching` while the read runs, or `''` when there is no read
     * (`docs/design/rowEditorOpenDecisions.md` R3).
     *
     * ⛔ The primitive speaks this string only while the popup shows. Its region holds the string then and `''`
     * otherwise, and a region speaks only when its content changes. So the string is spoken once when the popup opens
     * on it, and once at each change while the popup shows. It is not spoken at the close, while the popup is hidden,
     * or on a render that passes it unchanged.
     *
     * "Settled", to the primitive, is a change of this string: it cannot see a read, so it takes each new string as a
     * new result. Change the string only when the read for the field's text changes state, and pass the identical
     * string on every other render (a refetch with the same answer, a focus move, any re-render). Leaving a count for
     * another string and coming back to it is two changes, so the count is spoken twice.
     */
    readonly countAnnouncement: string;
    /**
     * The assertive channel: a failure the cook must hear now. Never held back by the popup: a pick closes the list
     * before its failure arrives (R3). Each field owns its own region, so a host serving several fields gives text
     * only to the one it is serving and `''` to the rest, or the text is spoken once per field.
     */
    readonly alertAnnouncement?: string;
    /**
     * Counts the events that say {@link alertAnnouncement}: each change speaks it again even when its text is the same,
     * as a refused press must (`docs/design/rowEditorOpenDecisions.md` R8, `LiveRegion`'s `occurrence`). Absent: the
     * alert speaks only when its text changes.
     */
    readonly alertOccurrence?: number;
    /**
     * The field took focus. A host that serves several fields from one search makes this one its target here
     * (`docs/design/rowEditorBlueprint.md` decision 1).
     */
    readonly onFocus?: () => void;
    /**
     * WEB: the cook abandons the entry with Escape while the list is closed, and the host puts back what the line
     * holds. Without it, that Escape is left to the page. Native has no Escape key, so it abandons through
     * {@link cancel} or the host's back intercept.
     */
    readonly onAbandon?: () => void;
    /** A `Cancel` button at the field's trailing end. */
    readonly cancel?: ComboboxCancel;
    /**
     * A control the host puts beside the field, in the field's own row after the input (the empty Ingredients section's
     * Paste a list, build spec §7.5.4). It lines up with the input, not with the label above it. The host draws it,
     * names it and owns what it does; the primitive only places it.
     */
    readonly trailingAction?: ReactNode;
    /** NATIVE ONLY: a clear button, shown while the field holds text. */
    readonly clear?: ComboboxClear;
    /**
     * A decorative glyph before the field, in the platform's idiom, such as the trailing add row's plus
     * (`docs/design/rowEditorOpenDecisions.md` item 3). Hidden from assistive technology: the field's name says what it
     * does.
     */
    readonly leadingIcon?: ReactNode;
    /**
     * A hint that describes the field (WCAG 3.3.2). Drawn as a caption under the visible label; with the label hidden
     * it is read and not drawn.
     */
    readonly hint?: string;
    /**
     * A line the host draws directly under the field, before the list (the ingredient add field's live reading, build
     * spec §7.5.3). On native the list is in the page's flow, so a line after the combobox would sit below the list.
     */
    readonly belowField?: ReactNode;
    readonly invalid?: boolean;
    /** Web: the id of another element that describes the field, after the hint. */
    readonly describedBy?: string;
    /**
     * A host asks for focus in the field with the caret at the end (§2d: Change food, the trailing row after an
     * append). A LEVEL, not a counter: it stands until {@link onFocusRequestHandled} acknowledges it, so a field that
     * mounts while the request stands still takes it.
     */
    readonly focusRequested?: boolean;
    /** Called once the field has taken a requested focus; the host clears its request here. */
    readonly onFocusRequestHandled?: () => void;
    /**
     * The list opens whenever the field takes focus, so a field over a short fixed list (the recipe's cuisine) can be
     * browsed without typing first. Opening chooses nothing and activates nothing (3.2.2). Without it the list opens only
     * when the cook types or presses Down.
     */
    readonly openOnFocus?: boolean;
    /**
     * With {@link focusRequested}: the list opens as the field takes focus, so the cook can choose a food without
     * editing the text first (a refused save that points at this field, `docs/design/rowEditorOpenDecisions.md` R7). It
     * rides the focus request, and the same {@link onFocusRequestHandled} acknowledges both.
     */
    readonly listRequested?: boolean;
    /**
     * Which of the APG's two models the field follows (`docs/design/uiOverhaul/cuisineField.md` §4 P1). An enum, not a
     * boolean, because it names the model:
     *
     * - `needsChoice` (the default): the value must be picked, as a food is. Submitting with nothing chosen leaves the
     *   list open and the keyboard up, and the host says why.
     * - `isValue`: "list autocomplete with manual selection", where the typed text becomes the value unless the cook
     *   picks an option (the recipe's cuisine). Submitting with nothing chosen still calls
     *   {@link onSubmitWithoutChoice}, and also closes the list. On native the return key reads Done and dismisses the
     *   keyboard, a pick dismisses it too, and the list closes when the keyboard hides while the field has focus
     *   (Android Back does not blur a `TextInput`).
     */
    readonly typedText?: 'needsChoice' | 'isValue';
    /** The field lost focus: Tab, a press elsewhere, or the keyboard's Done. Nothing is chosen by it (3.2.2). */
    readonly onBlur?: () => void;
    /**
     * NATIVE ONLY (`cuisineField.md` §4 P2): with more options than this, the options sit in a scroller of their own,
     * `listMaxRows + 0.5` rows tall at the current font scale (the half row shows that it scrolls) and never taller than
     * 45% of the window, so a long fixed list does not push the rest of the page out of reach. Absent: the list is as
     * tall as its options. The web list needs nothing: its popup already scrolls inside a 20rem cap.
     */
    readonly listMaxRows?: number;
    /**
     * Native only (the web page scrolls itself through `ScrollHost.revealSpan`; web ignores it): a row just arrived
     * straight above this field, and the scroller around it should show the row and the field together
     * (`docs/design/uiOverhaul/ingredientArrival.md`). Asked once per `key`; a new key asks again, and removing it
     * (the cook typed on, or moved to another row) releases the ask. The host sets it only once the row has laid out.
     */
    readonly arrival?: ComboboxArrival;
}

/** The row that arrived above a combobox. */
export interface ComboboxArrival {
    /** The row's key: one ask per key. */
    readonly key: string;
    /** The dp from the row's top to the top of this combobox: the row's height and whatever sits between them. */
    readonly aboveDp: number;
}
