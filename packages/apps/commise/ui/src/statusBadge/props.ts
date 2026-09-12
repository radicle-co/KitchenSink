/**
 * @module @commise/ui/status-badge — the shared contract for the chip that states a line's status beside its name.
 */

/**
 * How the badge reads. A display derivation, never a behaviour switch.
 *
 * - `neutral` — a fact with nothing to fix (a line the cook typed in).
 * - `caution` — the reader can act on it (a line to review, a food to pick, a food that was removed).
 *
 * ⚠️ Deliberately NOT `StandInTone`, though the members match today: a stand-in's tone and a status's tone change for
 * different reasons, and one shared type would make a new tone on one silently a tone on the other.
 */
export type StatusBadgeTone = 'neutral' | 'caution';

/** Props for the `StatusBadge` leaves (web and native). */
export interface StatusBadgeProps {
    /** How the badge reads. */
    readonly tone: StatusBadgeTone;
    /** The localized status words. The design system carries no copy of its own. */
    readonly children: string;
}
