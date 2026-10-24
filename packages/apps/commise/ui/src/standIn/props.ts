/**
 * @module @commise/ui/stand-in — the shared contract for the chip that stands where a missing value would be.
 */

/**
 * How the stand-in reads. A display derivation, never a behaviour switch.
 *
 * - `neutral` — nothing is wrong that the reader can fix here (a private food, a value not loaded).
 * - `caution` — the reader can act on it (a food that was removed).
 */
export type StandInTone = 'neutral' | 'caution';

/** Props for the `StandIn` leaves (web and native). */
export interface StandInProps {
    /** How the chip reads. */
    readonly tone: StandInTone;
    /** The localized words that stand in for the missing value. The design system carries no copy of its own. */
    readonly children: string;
}
