/**
 * @module @commise/ui/input — the shared contract of the design-system text fields: `Input`, `TextArea` and the
 * `FieldLabel` that names them (`docs/architecture/uiOverhaulBlueprint.md` Part B; `docs/design/uiOverhaul/buildSpec.md`
 * §1.11). Both platform leaves of each implement exactly these props.
 *
 * A field does not render its own label or message. `FieldLabel` is a separate primitive, placed above the field, and
 * the two are paired by id: the web label's `htmlFor`, and on native the label's `nativeID` ({@link fieldLabelId}),
 * which the field's `aria-labelledby` names. A field with a message takes `invalid` and the id of the element that
 * carries it (`describedBy`), so the caller places the message wherever its layout needs it.
 *
 * The keyboard, autofill and return-key hints are the HTML attribute vocabularies, which React Native's `TextInput`
 * takes under the same names (`inputMode`, `autoComplete`, `enterKeyHint`) and maps to each OS itself.
 */

/** The keyboard a field asks for. */
export type InputMode = 'text' | 'email' | 'numeric' | 'decimal' | 'tel' | 'url' | 'search';

/** The autofill a field offers. */
export type InputAutoComplete =
    | 'off'
    | 'email'
    | 'name'
    | 'given-name'
    | 'family-name'
    | 'username'
    | 'current-password'
    | 'new-password'
    | 'one-time-code';

/** What the keyboard's return key says. */
export type EnterKeyHint = 'done' | 'go' | 'next' | 'search' | 'send';

/** What every text field shares. */
interface FieldCommon {
    /** The field's id: the target of its `FieldLabel`, and of nothing else. Unique on the page. */
    readonly id: string;
    /** The controlled value. */
    readonly value: string;
    /** Called with the new value on each edit. */
    readonly onChangeText: (text: string) => void;
    /** The field holds a value its form rejects: a `danger` edge and `aria-invalid`. */
    readonly invalid?: boolean;
    /** The id of the element that describes the field — a hint, an error, or both, space-separated. */
    readonly describedBy?: string;
    /**
     * The message the caller draws for this field (WCAG 3.3.1), repeated here for the platform that cannot link them.
     * Native only: React Native has no `aria-describedby` and no `aria-invalid`, so the field's `accessibilityHint` is
     * this text and a screen reader speaks it on reaching the field; present means invalid, the `danger` edge too. On
     * native `invalid` alone paints the edge and `describedBy` is not used. The caller still draws the message wherever
     * its layout needs it. The web leaf ignores `error`, because `invalid` and `describedBy` already tie the message to
     * the field there.
     */
    readonly error?: string;
    /**
     * The visible label's text, repeated as the field's accessible name. Native only: the field's `aria-labelledby` is
     * honoured on Android alone, and `accessibilityLabel` is what iOS reads. The web leaf ignores it, because the
     * label's `htmlFor` names the field there.
     */
    readonly label?: string;
    /** An example value, never a label (spec §2.2: no "..." in a placeholder). */
    readonly placeholder?: string;
    /** Capitalisation the keyboard applies while typing. */
    readonly autoCapitalize?: 'none' | 'sentences' | 'words';
    /** The field cannot be edited, for a rule the person's input did not cause. Dims to 40% (§1.10). */
    readonly disabled?: boolean;
    /**
     * A host asks the field to take focus (a field it has just shown, such as a group's name, or the step it has just
     * added). A LEVEL, as `Button`'s: it stands until {@link onFocusRequestHandled} acknowledges it, so a field that
     * mounts while it stands takes it.
     */
    readonly focusRequested?: boolean;
    /** Called once the field has taken a requested focus; the host clears its request here. */
    readonly onFocusRequestHandled?: () => void;
}

/** The cross-platform `Input` contract: a one-line text field. */
export interface InputProps extends FieldCommon {
    /** The keyboard to show. Defaults to the platform's text keyboard. */
    readonly inputMode?: InputMode;
    /** The autofill to offer. */
    readonly autoComplete?: InputAutoComplete;
    /** Whether the keyboard corrects and checks spelling. Absent, the platform decides; `false` for a non-word. */
    readonly autoCorrect?: boolean;
    /** What the return key says. */
    readonly enterKeyHint?: EnterKeyHint;
    /** Hide what is typed (a password). */
    readonly secret?: boolean;
    /** Called when the person presses return in the field. */
    readonly onSubmit?: () => void;
    /** The most characters the field takes; typing stops there, so a too-long value is never entered. */
    readonly maxLength?: number;
}

/** The cross-platform `TextArea` contract: a multi-line field that grows with its content. */
export interface TextAreaProps extends FieldCommon {
    /** The height it starts at, in lines. */
    readonly minRows: number;
    /** The height it stops growing at, in lines; past it, the field scrolls. Absent, it grows without bound. */
    readonly maxRows?: number;
}

/** The cross-platform `FieldLabel` contract: the visible label above a field, and an optional hint under it. */
export interface FieldLabelProps {
    /** The id of the field it names. */
    readonly forId: string;
    /** The label text. */
    readonly label: string;
    /** A short hint in the `caption` role, under the label. The field names {@link fieldHintId} in `describedBy`. */
    readonly hint?: string;
}

/**
 * The cross-platform `Stepper` contract: `[−] value [+]` for a small whole number (spec §1.11; servings).
 *
 * ⚠️ `decreaseLabel` and `increaseLabel` are not in the blueprint's contract: the two buttons need names ("Fewer
 * servings"), that is user-facing copy, and `@commise/ui` holds no message catalogue.
 */
export interface StepperProps {
    /** The control's id; its label is named by it. */
    readonly id: string;
    /** The label, which names the group. */
    readonly label: string;
    /**
     * Whether the label shows. Defaults to `visible`. `hidden` keeps it as the group's name but out of sight, for a
     * heading row that already says what the number is (the recipe page's "for {n}", `buildSpec.md` §6.1).
     */
    readonly labelVisibility?: 'visible' | 'hidden';
    /** The controlled value. */
    readonly value: number;
    /** The smallest value. Defaults to 1. */
    readonly min?: number;
    /** The largest value, if bounded. */
    readonly max?: number;
    /** Called with the new value after a press. */
    readonly onChange: (value: number) => void;
    /** The sentence spoken (politely) after a press changes the value, e.g. "Serves 3". */
    readonly announce: (value: number) => string;
    /** The localised name of the − button. */
    readonly decreaseLabel: string;
    /** The localised name of the + button. */
    readonly increaseLabel: string;
    /**
     * The message the caller draws for this control (WCAG 3.3.1), repeated here for the platform that cannot link them.
     * Native only: React Native has no `aria-describedby`, so it is the accessibility hint of both buttons, where the
     * screen-reader cursor lands. The web leaf ignores it.
     */
    readonly error?: string;
}

/**
 * The value a step reaches, or `null` when the step would leave the bounds. Pure.
 *
 * @param value - The current value.
 * @param step - `-1` or `1`.
 * @param min - The smallest value.
 * @param max - The largest value, if bounded.
 * @returns The next value, or `null` at a bound.
 */
export function stepFrom(value: number, step: -1 | 1, min: number, max: number | undefined): number | null {
    const next = value + step;

    if (next < min || (max !== undefined && next > max)) {
        return null;
    }

    return next;
}

/**
 * The id a field's label carries on native, which the field's `aria-labelledby` names. Pure.
 *
 * @param fieldId - The field's id.
 * @returns The label's id.
 */
export function fieldLabelId(fieldId: string): string {
    return `${fieldId}-label`;
}

/**
 * The id a field's hint carries, for the field's `describedBy`. Pure.
 *
 * @param fieldId - The field's id.
 * @returns The hint's id.
 */
export function fieldHintId(fieldId: string): string {
    return `${fieldId}-hint`;
}

/**
 * The id a field's error message carries, for the field's `aria-describedby` (web). Pure.
 *
 * @param fieldId - The field's id.
 * @returns The error's id.
 */
export function fieldErrorId(fieldId: string): string {
    return `${fieldId}-error`;
}

/**
 * What a native field's `accessibilityHint` says: its error, a space, then its hint, or whichever of the two exists
 * (cuisineField.md §3.3, P4). React Native has no `aria-describedby`, so this is the only way a native field's message
 * reaches VoiceOver and TalkBack. The error leads because it is the news. Pure.
 *
 * @param error - The field's error message, if it has one.
 * @param hint - The field's hint, if it has one.
 * @returns The hint to speak, or `undefined` when there is nothing to say.
 */
export function fieldAccessibilityHint(error: string | undefined, hint: string | undefined): string | undefined {
    const parts = [error, hint].filter((part): part is string => part !== undefined);

    return parts.length === 0 ? undefined : parts.join(' ');
}
