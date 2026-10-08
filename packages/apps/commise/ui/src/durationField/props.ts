/**
 * @module @commise/ui/duration-field — prop contract for `DurationField`, shared by its web and native leaves.
 */

/** The contract for a duration entered as hours and minutes and stored in seconds. */
export interface DurationFieldProps {
    /** The visible label above the two boxes; it names the group they sit in. */
    readonly label: string;
    /** The hours box's accessible name (the visible unit beside it is decorative). */
    readonly hoursLabel: string;
    /** The minutes box's accessible name. */
    readonly minutesLabel: string;
    /** The short unit shown after the hours box, e.g. "h". */
    readonly hoursUnit: string;
    /** The short unit shown after the minutes box, e.g. "min". */
    readonly minutesUnit: string;
    /** The stored duration in seconds, or `undefined` for none. */
    readonly value: number | undefined;
    /** Reports every edit as the whole duration in seconds, or `undefined` when both boxes are empty. */
    readonly onChange: (seconds: number | undefined) => void;
}
