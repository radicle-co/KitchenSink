/**
 * @module @commise/ui/difficulty-badge — the shared contract of the design-system `DifficultyBadge`: a recipe's stated
 * difficulty as a tint, a three-dot meter and the word (`docs/design/uiOverhaul/buildSpec.md` §1.4). The meter and the
 * word carry the meaning, so it never rests on colour alone (SC 1.4.1). `error` is never a difficulty colour.
 *
 * The word stays the caller's (`children`), because it is localised copy and `@commise/ui` holds no catalogue.
 */
import type { Difficulty } from '../tokens/tones.js';

/** A difficulty's level. */
export type DifficultyLevel = Difficulty;

/** How many of the meter's three dots each level fills. */
export const DIFFICULTY_METER: Readonly<Record<DifficultyLevel, 1 | 2 | 3>> = { easy: 1, medium: 2, hard: 3 };

/** The meter's length. */
export const METER_DOTS = 3;

/** The cross-platform `DifficultyBadge` contract. */
export interface DifficultyBadgeProps {
    /** The stated difficulty. */
    readonly level: DifficultyLevel;
    /** The difficulty's word ("Medium"). Announced with the text the badge sits in. */
    readonly children: string;
}
